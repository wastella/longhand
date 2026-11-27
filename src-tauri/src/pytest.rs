//! Runs the folder's pytest suite and reports on it as it goes.
//!
//! pytest runs with a small reporter plugin (pytest/plugin.py) that writes one JSON record per
//! test phase to a file, which is read while the run goes on. The interface hears:
//! - `tests:output`: pytest's own terminal text, in pieces as it arrives (the raw output)
//! - `tests:progress`: a list of updates (see `report::Update`)
//! - `tests:done`: the whole result, with a plain-words `problem` when there are no results

mod output;
mod problem;
mod report;

use crate::workspace::{log_event, workspace, AppState};
use output::{LineReader, Tail, Utf8Stream};
use report::Report;
use serde_json::{json, Value};
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

const PLUGIN: &str = include_str!("pytest/plugin.py");
const PLUGIN_MODULE: &str = "longhand_pytest";
/// How much of pytest's terminal text a finished run keeps (the end, where the summary is).
const OUTPUT_LIMIT: usize = 2_000_000;
/// How long processes get to stop after being asked before they are made to.
const STOP_GRACE: Duration = Duration::from_secs(2);
const POLL: Duration = Duration::from_millis(100);

#[derive(Default)]
pub struct TestRun {
    pgid: Option<i32>,
    generation: u64,
    cancelled: bool,
}

pub fn cancel(state: &AppState) {
    let mut run = state.tests.lock().unwrap();
    if let Some(pgid) = run.pgid.take() {
        run.cancelled = true;
        stop_group(pgid);
    }
}

/// Stops every process in the run's group: the shell, uv, pytest and anything a test started.
fn stop_group(pgid: i32) {
    unsafe { libc::kill(-pgid, libc::SIGTERM) };
    // A test can ignore SIGTERM or hang in native code. Group ids are not reused while any
    // member lives, and reuse by a new group within the grace period is vanishingly unlikely.
    std::thread::spawn(move || {
        std::thread::sleep(STOP_GRACE);
        unsafe { libc::kill(-pgid, libc::SIGKILL) };
    });
}

fn shell_quote(s: &str) -> String {
    if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "@%+=:,./-_[]".contains(c)) {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
    }
}

/// pytest's arguments for these node ids or paths (all tests when empty).
fn pytest_args(targets: &[String]) -> Result<Vec<String>, String> {
    let mut args = vec!["--tb=short".to_string(), "--color=no".into()];
    for target in targets {
        if target.is_empty() || target.starts_with('-') {
            return Err(format!("\"{target}\" is not a test"));
        }
        args.push(target.clone());
    }
    Ok(args)
}

fn quoted(args: &[String]) -> String {
    args.iter().map(|a| shell_quote(a)).collect::<Vec<_>>().join(" ")
}

/// Writes the reporter where Python can import it, and returns that directory.
fn install_plugin() -> std::io::Result<PathBuf> {
    let dir = std::env::temp_dir().join(format!("longhand-pytest-{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(format!("{PLUGIN_MODULE}.py")), PLUGIN)?;
    Ok(dir)
}

/// Starts `runner` (`uv run pytest` or `python3 -m pytest`) in a login shell, so the tools resolve
/// the way they do in the student's terminal, in a process group of its own so it can be stopped.
fn spawn(folder: &Path, runner: &str, args: &[String], plugin_dir: &Path, report: &Path) -> std::io::Result<Child> {
    let python_path = match std::env::var_os("PYTHONPATH") {
        Some(existing) if !existing.is_empty() => format!("{}:{}", plugin_dir.display(), existing.to_string_lossy()),
        _ => plugin_dir.display().to_string(),
    };
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    Command::new(shell)
        .args(["-lc", &format!("{runner} -p {PLUGIN_MODULE} {} 2>&1", quoted(args))])
        .current_dir(folder)
        .env("PYTHONPATH", python_path)
        .env("LONGHAND_PYTEST_REPORT", report)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
}

struct Watch {
    app: AppHandle,
    generation: u64,
    folder: PathBuf,
    report: PathBuf,
    command: String,
    uses_uv: bool,
    targets: Vec<String>,
}

impl Watch {
    fn current(&self) -> bool {
        self.app.state::<AppState>().tests.lock().unwrap().generation == self.generation
    }

    fn emit(&self, event: &str, payload: impl serde::Serialize + Clone) {
        if self.current() {
            let _ = self.app.emit(event, payload);
        }
    }
}

/// Starts a run of `targets` (node ids or paths; all tests when empty or absent). Returns
/// `{ command }` for a run that started, or `{ problem }` when there is no point in starting one.
#[tauri::command]
pub fn tests_run(app: AppHandle, state: State<AppState>, targets: Option<Vec<String>>) -> Result<Value, String> {
    let folder = workspace(&state)?;
    cancel(&state);
    if let Some(problem) = problem::not_python(&folder) {
        return Ok(json!({ "problem": problem }));
    }
    let targets = targets.unwrap_or_default();
    let args = pytest_args(&targets)?;
    let uses_uv = folder.join("uv.lock").exists() || folder.join("pyproject.toml").exists();
    let runner = if uses_uv { "uv run pytest" } else { "python3 -m pytest" };
    let command = format!("{runner} {}", quoted(&args));
    log_event(&folder, "tests", json!({ "target": if targets.is_empty() { "all".to_string() } else { targets.join(" ") } }));

    let report = std::env::temp_dir().join(format!("longhand-pytest-{}.jsonl", uuid::Uuid::new_v4()));
    let plugin_dir = install_plugin().map_err(|e| format!("Could not prepare the test run: {e}"))?;
    let child = spawn(&folder, runner, &args, &plugin_dir, &report).map_err(|e| format!("Could not start the shell: {e}"))?;
    let generation = {
        let mut run = state.tests.lock().unwrap();
        run.generation += 1;
        run.pgid = Some(child.id() as i32);
        run.cancelled = false;
        run.generation
    };
    let watch = Watch { app, generation, folder, report, command: command.clone(), uses_uv, targets };
    std::thread::spawn(move || follow(watch, child));
    Ok(json!({ "command": command }))
}

/// Relays a run's output and records until it ends, then sends the result.
fn follow(watch: Watch, mut child: Child) {
    let began = Instant::now();
    let mut stdout = child.stdout.take().expect("stdout is piped");
    let app = watch.app.clone();
    let generation = watch.generation;
    let reader = std::thread::spawn(move || {
        let (mut stream, mut tail, mut buf) = (Utf8Stream::default(), Tail::new(OUTPUT_LIMIT), [0u8; 8192]);
        let mut relay = |text: String| {
            if !text.is_empty() && app.state::<AppState>().tests.lock().unwrap().generation == generation {
                let _ = app.emit("tests:output", &text);
            }
            tail.push(&text);
        };
        while let Ok(n @ 1..) = stdout.read(&mut buf) {
            relay(stream.push(&buf[..n]));
        }
        relay(stream.finish());
        tail.into_string()
    });

    let mut lines = LineReader::new(watch.report.clone());
    let mut report = Report::new(&watch.folder);
    loop {
        // Checked before reading, so the last read sees everything written before the end.
        let finished = reader.is_finished();
        let updates: Vec<report::Update> = lines.read_lines().iter().filter_map(|line| report.apply(line)).collect();
        if !updates.is_empty() {
            watch.emit("tests:progress", &updates);
        }
        if finished {
            break;
        }
        std::thread::sleep(POLL);
    }
    let output = reader.join().unwrap_or_default();
    let code = child.wait().ok().and_then(|s| s.code());
    let _ = std::fs::remove_file(&watch.report);

    let cancelled = {
        let state = watch.app.state::<AppState>();
        let mut run = state.tests.lock().unwrap();
        if run.generation != watch.generation {
            return; // a newer run replaced this one
        }
        run.pgid = None;
        run.cancelled
    };
    let problem = (!cancelled)
        .then(|| {
            problem::diagnose(&problem::Outcome {
                uses_uv: watch.uses_uv,
                code,
                output: &output,
                started: report.started,
                collected: report.total,
                errors: report.errors.len(),
                targeted: !watch.targets.is_empty(),
            })
        })
        .flatten();
    let seconds = began.elapsed().as_secs_f64();
    let done = json!({
        "command": watch.command,
        "targets": watch.targets,
        "code": code,
        "cancelled": cancelled,
        "problem": problem,
        "summary": report::summary(&report.tests, report.errors.len(), seconds),
        "total": report.total,
        "duration": seconds,
        "tests": report.tests,
        "errors": report.errors,
        "output": output,
    });
    watch.emit("tests:done", done);
}

#[tauri::command]
pub fn tests_cancel(state: State<AppState>) {
    cancel(&state);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quoting_protects_odd_test_ids() {
        assert_eq!(shell_quote("tests/test_m.py::test_a[1-2]"), "tests/test_m.py::test_a[1-2]");
        assert_eq!(shell_quote("tests/t.py::test_p[a b]"), "'tests/t.py::test_p[a b]'");
        assert_eq!(shell_quote("my tests/t.py"), "'my tests/t.py'");
        assert_eq!(shell_quote("a'b; rm -rf x"), r"'a'\''b; rm -rf x'");
    }

    #[test]
    fn targets_cannot_be_options() {
        assert_eq!(pytest_args(&[]).unwrap(), ["--tb=short", "--color=no"]);
        assert_eq!(pytest_args(&["t.py::a".into(), "t.py::b".into()]).unwrap().len(), 4);
        assert!(pytest_args(&["--collect-only".into()]).is_err());
        assert!(pytest_args(&[String::new()]).is_err());
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("longhand-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn wait_for(child: &mut Child, limit: Duration) -> bool {
        let start = Instant::now();
        while start.elapsed() < limit {
            if child.try_wait().unwrap().is_some() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        false
    }

    #[test]
    fn stopping_ends_the_whole_group() {
        let dir = scratch("stop");
        // A stand-in "runner" with a child of its own that ignores SIGTERM.
        let mut child = spawn(&dir, "sh -c 'trap \"\" TERM; sleep 30' & sleep 30; wait; :", &[], &dir, &dir.join("r")).unwrap();
        let pgid = child.id() as i32;
        std::thread::sleep(Duration::from_millis(300));
        stop_group(pgid);
        assert!(wait_for(&mut child, Duration::from_secs(5)), "the shell stopped");
        std::thread::sleep(STOP_GRACE + Duration::from_millis(500));
        assert_eq!(unsafe { libc::kill(-pgid, 0) }, -1, "nothing in the group survived");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// A Python with pytest installed, named by full path because a login shell's PATH may differ.
    fn python_with_pytest() -> Option<String> {
        let found = Command::new("python3").args(["-c", "import sys, pytest; print(sys.executable)"]).output().ok()?;
        found.status.success().then(|| String::from_utf8_lossy(&found.stdout).trim().to_string())
    }

    #[test]
    fn the_reporter_works_with_real_pytest() {
        let Some(python) = python_with_pytest() else {
            eprintln!("skipped: python3 has no pytest here");
            return;
        };
        let dir = scratch("real-pytest");
        std::fs::create_dir_all(dir.join("tests")).unwrap();
        std::fs::write(
            dir.join("tests/test_real.py"),
            "import pytest\n\ndef test_ok():\n    assert 1\n\ndef test_bad():\n    assert 1 == 2\n\n@pytest.mark.parametrize('x', ['a b', 2])\ndef test_p(x):\n    assert x == 2\n",
        )
        .unwrap();
        let plugin = install_plugin().unwrap();
        let file = dir.join("report.jsonl");
        let args = pytest_args(&["tests/test_real.py".into()]).unwrap();
        // Without the machine's other plugins, so a broken one cannot fail this test.
        let runner = format!("PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 {} -m pytest", shell_quote(&python));
        let mut child = spawn(&dir, &runner, &args, &plugin, &file).unwrap();
        let mut text = String::new();
        child.stdout.take().unwrap().read_to_string(&mut text).unwrap();
        assert_eq!(child.wait().unwrap().code(), Some(1), "{text}");
        let mut report = Report::new(&dir);
        for line in std::fs::read_to_string(&file).unwrap_or_else(|e| panic!("{e}: {text}")).lines() {
            report.apply(line);
        }
        let got: Vec<String> = report.tests.iter().map(|t| format!("{:?} {}", t.status, t.id)).collect();
        assert_eq!(
            got,
            [
                "Passed tests/test_real.py::test_ok",
                "Failed tests/test_real.py::test_bad",
                "Failed tests/test_real.py::test_p[a b]",
                "Passed tests/test_real.py::test_p[2]"
            ]
        );
        assert_eq!(report.tests[1].message, "assert 1 == 2");
        assert!(text.contains("2 failed, 2 passed"), "pytest's own output is unchanged: {text}");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
