//! Runs the folder's pytest suite and reports on it as it goes.
//!
//! pytest runs with a small reporter plugin (pytest/plugin.py) that writes one JSON record per
//! test phase to a file, which is read while the run goes on. Every event carries the run's id
//! (`run`, as the interface passed it to `tests_run`), so an event from an earlier run is never
//! taken for the current one. The interface hears:
//! - `tests:output` `{ run, text }`: pytest's own terminal text, a few times a second (the raw output)
//! - `tests:progress` `{ run, updates }`: a list of updates (see `report::Update`)
//! - `tests:done`: the whole result, with a plain-words `problem` when something went wrong
//!
//! A run that is cancelled or replaced sends nothing more: the interface ends it itself.

mod output;
mod problem;
mod report;

use crate::workspace::{log_event, workspace, AppState};
use output::{Captured, LineReader, Utf8Stream};
use report::{Exit, Report};
use serde_json::{json, Value};
use std::io::Read;
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

const PLUGIN: &str = include_str!("pytest/plugin.py");
const PLUGIN_MODULE: &str = "longhand_pytest";
/// Where the reporter and each run's files live: `longhand-pytest-<the app's pid>` in the
/// temporary folder, removed when the app quits (and found and removed at the next start if
/// it could not be).
const DIR_PREFIX: &str = "longhand-pytest-";
/// pytest's options for every run. `--rootdir=.` keeps node ids relative to the open folder
/// even when a pytest.ini in a folder above it would make pytest root them there.
const OPTIONS: [&str; 3] = ["--rootdir=.", "--tb=short", "--color=no"];
/// How much of pytest's terminal text a finished run keeps (the end, where the summary is).
const OUTPUT_LIMIT: usize = 2_000_000;
/// The most output sent to the interface at once; more than this between two sends is skipped.
const OUTPUT_BATCH: usize = 256_000;
/// How long processes get to stop after being asked before they are made to.
const STOP_GRACE: Duration = Duration::from_secs(2);
/// How long a run's end waits for its output to close, which a background process a test
/// started can hold open for ever.
const OUTPUT_GRACE: Duration = Duration::from_secs(1);
const POLL: Duration = Duration::from_millis(100);

#[derive(Default)]
pub struct TestRun {
    pgid: Option<i32>,
    generation: u64,
}

/// Stops the current run, if any. Whatever it would still have said is dropped.
pub fn cancel(state: &AppState) {
    let mut run = state.tests.lock().unwrap();
    run.generation += 1;
    if let Some(pgid) = run.pgid.take() {
        stop_group(pgid);
    }
}

/// For the app quitting: stops the run and waits for it to be gone, then removes the reporter.
pub fn shutdown(state: &AppState) {
    let pgid = {
        let mut run = state.tests.lock().unwrap();
        run.generation += 1;
        run.pgid.take()
    };
    if let Some(pgid) = pgid {
        stop_group_now(pgid, STOP_GRACE);
    }
    let _ = std::fs::remove_dir_all(plugin_dir());
}

fn group_alive(pgid: i32) -> bool {
    unsafe { libc::kill(-pgid, 0) == 0 }
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

/// Like `stop_group`, but returns only once the group is gone, for when the app is quitting
/// and a thread left to finish the job would not get the chance.
fn stop_group_now(pgid: i32, grace: Duration) {
    unsafe { libc::kill(-pgid, libc::SIGTERM) };
    let start = Instant::now();
    while group_alive(pgid) && start.elapsed() < grace {
        std::thread::sleep(Duration::from_millis(20));
    }
    unsafe { libc::kill(-pgid, libc::SIGKILL) };
}

/// Quotes a word for a POSIX shell (or zsh). Every word is quoted, so nothing in it is special:
/// zsh would read `test_a[1-2]` as a pattern and refuse the command when nothing matched.
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

fn quoted(args: &[String]) -> String {
    args.iter().map(|a| shell_quote(a)).collect::<Vec<_>>().join(" ")
}

/// What to give pytest for a run of `targets` (node ids or paths; all tests when empty).
#[derive(Debug, Default, PartialEq)]
struct Plan {
    /// Files and folders, as pytest's arguments.
    args: Vec<String>,
    /// The tests to keep, when the run is of particular tests: the reporter's selection.
    ids: Vec<String>,
    /// Targets that were paths, kept whole when there is a selection.
    paths: Vec<String>,
    /// Targets whose file no longer exists.
    gone: Vec<String>,
}

impl Plan {
    /// Node ids are not given to pytest as arguments: one that no longer exists (a renamed
    /// test, say) would make pytest refuse the whole run. pytest gets their files, and the
    /// reporter keeps just the tests asked for.
    fn new(folder: &Path, targets: &[String]) -> Result<Plan, String> {
        let mut plan = Plan::default();
        for target in targets {
            if target.is_empty() || target.starts_with('-') || target.starts_with('@') {
                return Err(format!("\"{target}\" is not a test"));
            }
            let file = target.split("::").next().unwrap_or_default();
            if !folder.join(file).exists() {
                plan.gone.push(target.clone());
                continue;
            }
            if file != target {
                plan.ids.push(target.clone());
            } else {
                plan.paths.push(target.clone());
            }
            if !plan.args.iter().any(|a| a == file) {
                plan.args.push(file.to_string());
            }
        }
        Ok(plan)
    }

    fn selection(&self) -> Option<Value> {
        (!self.ids.is_empty()).then(|| json!({ "ids": self.ids, "paths": self.paths }))
    }
}

/// The reporter's folder for this app.
fn plugin_dir() -> PathBuf {
    std::env::temp_dir().join(format!("{DIR_PREFIX}{}", std::process::id()))
}

/// Writes the reporter where Python can import it, and returns that folder. The first time,
/// it also removes the folders of earlier app runs that ended without removing their own.
fn install_plugin() -> std::io::Result<PathBuf> {
    static CLEANED: OnceLock<()> = OnceLock::new();
    CLEANED.get_or_init(|| remove_stale(&std::env::temp_dir()));
    let dir = plugin_dir();
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(format!("{PLUGIN_MODULE}.py")), PLUGIN)?;
    Ok(dir)
}

/// Removes `longhand-pytest-<pid>` folders of processes that are no longer running.
fn remove_stale(temp: &Path) {
    let Ok(entries) = std::fs::read_dir(temp) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(pid) = name.strip_prefix(DIR_PREFIX).and_then(|p| p.parse::<i32>().ok()) else { continue };
        let running = unsafe { libc::kill(pid, 0) == 0 } || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM);
        if pid != std::process::id() as i32 && !running {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// The command a run's shell carries out: `runner` with the reporter, then pytest's arguments.
/// The reporter's folder joins PYTHONPATH here, after the login shell has read the student's
/// profile, so a profile that sets PYTHONPATH cannot leave the reporter out.
fn script(runner: &str, plugin_dir: &Path, args: &[String]) -> String {
    let options: Vec<String> = OPTIONS.iter().map(|o| o.to_string()).collect();
    format!(
        "PYTHONPATH={}\"${{PYTHONPATH:+:$PYTHONPATH}}\"; export PYTHONPATH; exec {runner} -p {PLUGIN_MODULE} {} {} 2>&1",
        shell_quote(&plugin_dir.to_string_lossy()),
        quoted(&options),
        quoted(args)
    )
}

/// The command as the student could type it to get the same run.
fn shown_command(runner: &str, targets: &[String]) -> String {
    let options: Vec<String> = OPTIONS.iter().map(|o| o.to_string()).collect();
    let targets = if targets.is_empty() { String::new() } else { format!(" {}", quoted(targets)) };
    format!("{runner} -p {PLUGIN_MODULE} {}{targets}", options.join(" "))
}

/// The run's shell: the student's login shell, so tools resolve the way they do in the
/// terminal, handing over to /bin/sh for the script (so it reads the same whatever that shell
/// is), in a process group of its own so it can be stopped.
fn command(shell: &str, folder: &Path, script: &str, report: &Path, selection: Option<&Path>) -> Command {
    let mut command = Command::new(shell);
    command
        .args(["-lc", "exec /bin/sh -c \"$LONGHAND_PYTEST_SCRIPT\""])
        .current_dir(folder)
        .env("LONGHAND_PYTEST_SCRIPT", script)
        .env("LONGHAND_PYTEST_REPORT", report)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0);
    match selection {
        Some(path) => command.env("LONGHAND_PYTEST_SELECT", path),
        None => command.env_remove("LONGHAND_PYTEST_SELECT"),
    };
    command
}

fn login_shell() -> String {
    std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/zsh".into())
}

struct Watch {
    app: AppHandle,
    generation: u64,
    run: Value,
    folder: PathBuf,
    files: Vec<PathBuf>,
    command: String,
    uses_uv: bool,
    targets: Vec<String>,
}

impl Watch {
    fn current(&self) -> bool {
        self.app.state::<AppState>().tests.lock().unwrap().generation == self.generation
    }

    fn emit(&self, event: &str, payload: Value) {
        if self.current() {
            let _ = self.app.emit(event, payload);
        }
    }
}

/// Starts a run of `targets` (node ids or paths; all tests when empty or absent). `run` is the
/// interface's id for the run, sent back in every event. Returns `{ run, command }` for a run
/// that started, or `{ run, problem }` when there is no point in starting one.
#[tauri::command]
pub fn tests_run(app: AppHandle, state: State<AppState>, targets: Option<Vec<String>>, run: Option<Value>) -> Result<Value, String> {
    let folder = workspace(&state)?;
    cancel(&state);
    let run = run.unwrap_or(Value::Null);
    if let Some(problem) = problem::not_python(&folder) {
        return Ok(json!({ "run": run, "problem": problem }));
    }
    let targets = targets.unwrap_or_default();
    let plan = Plan::new(&folder, &targets)?;
    if !targets.is_empty() && plan.args.is_empty() {
        // Everything asked for is gone: a run of none of it is complete, and found nothing.
        return Ok(json!({
            "run": run,
            "problem": problem::gone(),
            "complete": true,
            "collected": [],
            "targets": targets,
        }));
    }
    let uses_uv = folder.join("uv.lock").exists() || folder.join("pyproject.toml").exists();
    let runner = if uses_uv { "uv run pytest" } else { "python3 -m pytest" };
    let kept: Vec<String> = targets.iter().filter(|t| !plan.gone.contains(t)).cloned().collect();
    let shown = shown_command(runner, &kept);
    log_event(&folder, "tests", json!({ "target": if targets.is_empty() { "all".to_string() } else { targets.join(" ") } }));

    let dir = install_plugin().map_err(|e| format!("Could not prepare the test run: {e}"))?;
    let id = uuid::Uuid::new_v4();
    let report = dir.join(format!("run-{id}.jsonl"));
    let mut files = vec![report.clone()];
    let selection = match plan.selection() {
        Some(selection) => {
            let path = dir.join(format!("select-{id}.json"));
            std::fs::write(&path, selection.to_string()).map_err(|e| format!("Could not prepare the test run: {e}"))?;
            files.push(path.clone());
            Some(path)
        }
        None => None,
    };
    let generation = state.tests.lock().unwrap().generation;
    let mut child = command(&login_shell(), &folder, &script(runner, &dir, &plan.args), &report, selection.as_deref())
        .spawn()
        .map_err(|e| format!("Could not start the shell: {e}"))?;
    {
        let mut tests = state.tests.lock().unwrap();
        if tests.generation != generation {
            // Cancelled, or replaced by another run, while this one was starting.
            stop_group(child.id() as i32);
            std::thread::spawn(move || child.wait());
            return Ok(json!({ "run": run, "command": shown }));
        }
        tests.pgid = Some(child.id() as i32);
    }
    let watch = Watch { app, generation, run: run.clone(), folder, files, command: shown.clone(), uses_uv, targets: kept };
    std::thread::spawn(move || follow(watch, child));
    Ok(json!({ "run": run, "command": shown }))
}

/// Relays a run's output and records until it ends, then sends the result.
fn follow(watch: Watch, mut child: Child) {
    let began = Instant::now();
    let mut stdout = child.stdout.take().expect("stdout is piped");
    let captured = Arc::new(Mutex::new(Captured::new(OUTPUT_LIMIT, OUTPUT_BATCH)));
    let reader = {
        let captured = captured.clone();
        std::thread::spawn(move || {
            let (mut stream, mut buf) = (Utf8Stream::default(), [0u8; 8192]);
            while let Ok(n @ 1..) = stdout.read(&mut buf) {
                captured.lock().unwrap().push(&stream.push(&buf[..n]));
            }
            captured.lock().unwrap().push(&stream.finish());
        })
    };

    let mut lines = LineReader::new(watch.files[0].clone());
    let mut report = Report::new(&watch.folder);
    let send = |lines: Vec<String>, report: &mut Report| {
        let text = captured.lock().unwrap().take_fresh();
        if !text.is_empty() {
            watch.emit("tests:output", json!({ "run": watch.run, "text": text }));
        }
        let updates: Vec<report::Update> = lines.iter().filter_map(|line| report.apply(line)).collect();
        if !updates.is_empty() {
            watch.emit("tests:progress", json!({ "run": watch.run, "updates": updates }));
        }
    };
    // The end of the run is the end of the shell, not of its output: a process a test left
    // running can keep the output open long after.
    let status = loop {
        let status = child.try_wait().ok().flatten();
        send(lines.read_lines(), &mut report);
        if let Some(status) = status {
            break Some(status);
        }
        if !watch.current() {
            break None;
        }
        std::thread::sleep(POLL);
    };
    let ended = Instant::now();
    while !reader.is_finished() && ended.elapsed() < OUTPUT_GRACE {
        std::thread::sleep(Duration::from_millis(20));
    }
    send(lines.read_all(), &mut report);
    let output = captured.lock().unwrap().output();
    for file in &watch.files {
        let _ = std::fs::remove_file(file);
    }
    let _ = child.wait();
    let Some(status) = status else { return };

    {
        let state = watch.app.state::<AppState>();
        let mut run = state.tests.lock().unwrap();
        if run.generation != watch.generation {
            return; // cancelled, or a newer run replaced this one
        }
        run.pgid = None;
    }
    let exit = Exit { code: status.code(), signal: status.signal() };
    let stopped_early = report.started && report.stopped_early();
    let complete = report.started && !stopped_early;
    // Whatever was running when the process ended gets an error rather than no result.
    report.end(exit);
    let problem = problem::diagnose(&problem::Outcome {
        uses_uv: watch.uses_uv,
        code: exit.code,
        output: &output,
        started: report.started,
        collected: report.total,
        errors: report.errors.len(),
        targeted: !watch.targets.is_empty(),
        stopped_early,
        interrupted: report.interrupted.as_deref().filter(|_| !report.stopped_for_collection_errors()),
        exit: exit.describe(),
    });
    let seconds = began.elapsed().as_secs_f64();
    let done = json!({
        "run": watch.run,
        "command": watch.command,
        "targets": watch.targets,
        "code": exit.code,
        "signal": exit.signal(),
        "cancelled": false,
        "complete": complete,
        "problem": problem,
        "summary": report::summary(&report.tests, report.errors.len(), seconds),
        "total": report.total,
        "collected": report.collected,
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
    fn every_word_is_quoted() {
        assert_eq!(shell_quote("tests/test_m.py::test_a[1-2]"), "'tests/test_m.py::test_a[1-2]'");
        assert_eq!(shell_quote("a=b"), "'a=b'");
        assert_eq!(shell_quote("a'b; rm -rf x"), r"'a'\''b; rm -rf x'");
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("longhand-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn plans_files_as_arguments_and_tests_as_a_selection() {
        let dir = scratch("plan");
        std::fs::create_dir_all(dir.join("tests")).unwrap();
        std::fs::write(dir.join("tests/test_a.py"), "").unwrap();
        assert_eq!(Plan::new(&dir, &[]).unwrap(), Plan::default());
        let ids: Vec<String> = ["tests/test_a.py::test_x[1-2]", "tests/test_a.py::T::test_y", "tests/test_gone.py::test_z", "tests"]
            .map(String::from)
            .to_vec();
        let plan = Plan::new(&dir, &ids).unwrap();
        assert_eq!(plan.args, ["tests/test_a.py", "tests"]);
        assert_eq!(plan.ids, ids[..2]);
        assert_eq!(plan.paths, ["tests"]);
        assert_eq!(plan.gone, ["tests/test_gone.py::test_z"]);
        for bad in ["--collect-only", "@args.txt", ""] {
            assert!(Plan::new(&dir, &[bad.to_string()]).is_err(), "{bad}");
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// The words the script hands its runner, as `shell` reads it.
    fn words(shell: &str, args: &[String]) -> Vec<String> {
        let script = script("/usr/bin/printf '%s\\n'", Path::new("/tmp/plug in"), args);
        let out = Command::new(shell).args(["-c", &script]).env("PYTHONPATH", "/mine").output().unwrap();
        String::from_utf8(out.stdout).unwrap().lines().map(str::to_string).collect()
    }

    #[test]
    fn arguments_reach_pytest_unchanged_in_sh_and_zsh() {
        let args: Vec<String> = ["tests/t.py::test_a[1-2]", "my tests/[x]*.py", "a'b", "$HOME", "x=y"].map(String::from).to_vec();
        let mut expected = vec!["-p".to_string(), PLUGIN_MODULE.into()];
        expected.extend(OPTIONS.map(String::from));
        expected.extend(args.clone());
        assert_eq!(words("/bin/sh", &args), expected);
        if Path::new("/bin/zsh").exists() {
            assert_eq!(words("/bin/zsh", &args), expected, "zsh does not read [ ] as a pattern");
        } else {
            eprintln!("skipped zsh: not installed");
        }
        // The reporter's folder comes first on PYTHONPATH, before what the profile set.
        let script = script("/bin/sh -c 'echo \"$PYTHONPATH\"' x", Path::new("/tmp/plug in"), &[]);
        let out = Command::new("/bin/sh").args(["-c", &script]).env("PYTHONPATH", "/mine").output().unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "/tmp/plug in:/mine");
    }

    #[test]
    fn removes_reporter_folders_of_apps_that_are_gone() {
        let temp = scratch("stale");
        // pid 1 is always running; a huge one never is.
        for name in ["longhand-pytest-1", "longhand-pytest-999999999", "longhand-pytest-notapid", "other"] {
            std::fs::create_dir_all(temp.join(name)).unwrap();
        }
        remove_stale(&temp);
        let mut left: Vec<String> = std::fs::read_dir(&temp).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into()).collect();
        left.sort();
        assert_eq!(left, ["longhand-pytest-1", "longhand-pytest-notapid", "other"]);
        std::fs::remove_dir_all(&temp).unwrap();
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

    /// A stand-in run whose own child ignores SIGTERM.
    fn stubborn(dir: &Path) -> Child {
        let script = "sh -c 'trap \"\" TERM; sleep 30' & sleep 30; wait";
        command("/bin/sh", dir, script, &dir.join("r"), None).spawn().unwrap()
    }

    #[test]
    fn stopping_ends_the_whole_group() {
        let dir = scratch("stop");
        let mut child = stubborn(&dir);
        let pgid = child.id() as i32;
        std::thread::sleep(Duration::from_millis(300));
        stop_group(pgid);
        assert!(wait_for(&mut child, Duration::from_secs(5)), "the shell stopped");
        std::thread::sleep(STOP_GRACE + Duration::from_millis(500));
        assert!(!group_alive(pgid), "nothing in the group survived");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn quitting_waits_until_the_group_is_gone() {
        let dir = scratch("quit");
        let mut child = stubborn(&dir);
        let pgid = child.id() as i32;
        std::thread::sleep(Duration::from_millis(300));
        stop_group_now(pgid, Duration::from_millis(500));
        let _ = wait_for(&mut child, Duration::from_secs(2));
        std::thread::sleep(Duration::from_millis(100));
        assert!(!group_alive(pgid), "even the child that ignores SIGTERM is gone when it returns");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// A Python with pytest installed, named by full path because a login shell's PATH may differ.
    fn python_with_pytest() -> Option<String> {
        let found = Command::new("python3").args(["-c", "import sys, pytest; print(sys.executable)"]).output().ok()?;
        found.status.success().then(|| String::from_utf8_lossy(&found.stdout).trim().to_string())
    }

    struct Ran {
        report: Report,
        exit: Exit,
        text: String,
    }

    /// Runs real pytest in `dir` as the app does, through zsh where there is one.
    fn run_pytest(python: &str, dir: &Path, targets: &[&str]) -> Ran {
        let targets: Vec<String> = targets.iter().map(|t| t.to_string()).collect();
        let plan = Plan::new(dir, &targets).unwrap();
        let plugin = install_plugin().unwrap();
        let id = uuid::Uuid::new_v4();
        let file = plugin.join(format!("test-{id}.jsonl"));
        let select = plugin.join(format!("test-{id}.json"));
        if let Some(selection) = plan.selection() {
            std::fs::write(&select, selection.to_string()).unwrap();
        }
        let shell = if Path::new("/bin/zsh").exists() { "/bin/zsh" } else { "/bin/sh" };
        let runner = format!("{} -m pytest", shell_quote(python));
        let mut command = command(shell, dir, &script(&runner, &plugin, &plan.args), &file, plan.selection().map(|_| select.as_path()));
        // Without the machine's other plugins, so a broken one cannot fail this test.
        command.env("PYTEST_DISABLE_PLUGIN_AUTOLOAD", "1");
        let mut child = command.spawn().unwrap();
        let mut text = String::new();
        child.stdout.take().unwrap().read_to_string(&mut text).unwrap();
        let status = child.wait().unwrap();
        let exit = Exit { code: status.code(), signal: status.signal() };
        let mut report = Report::new(dir);
        for line in std::fs::read_to_string(&file).unwrap_or_default().lines() {
            report.apply(line);
        }
        let _ = std::fs::remove_file(&file);
        let _ = std::fs::remove_file(&select);
        Ran { report, exit, text }
    }

    fn statuses(report: &Report) -> Vec<String> {
        report.tests.iter().map(|t| format!("{:?} {}", t.status, t.id)).collect()
    }

    const REAL: &str = "import pytest, unittest

def test_ok():
    assert 1

def test_bad():
    assert 1 == 2

@pytest.mark.parametrize('x', ['a b', 2, '1-2'])
def test_p(x):
    assert x == 2

class TestSub(unittest.TestCase):
    def test_sub(self):
        for i in range(3):
            with self.subTest(i=i):
                self.assertNotEqual(i, 1)

@pytest.fixture
def broken_teardown():
    yield
    raise RuntimeError('teardown broke')

def test_skip_then_teardown_error(broken_teardown):
    pytest.skip('not today')
";

    #[test]
    fn the_reporter_works_with_real_pytest() {
        let Some(python) = python_with_pytest() else {
            eprintln!("skipped: python3 has no pytest here");
            return;
        };
        let dir = scratch("real-pytest");
        std::fs::create_dir_all(dir.join("tests")).unwrap();
        std::fs::write(dir.join("tests/test_real.py"), REAL).unwrap();
        let ran = run_pytest(&python, &dir, &[]);
        assert_eq!(ran.exit.code, Some(1), "{}", ran.text);
        let report = ran.report;
        assert_eq!(
            statuses(&report),
            [
                "Passed tests/test_real.py::test_ok",
                "Failed tests/test_real.py::test_bad",
                "Failed tests/test_real.py::test_p[a b]",
                "Passed tests/test_real.py::test_p[2]",
                "Failed tests/test_real.py::test_p[1-2]",
                "Failed tests/test_real.py::TestSub::test_sub",
                "Error tests/test_real.py::test_skip_then_teardown_error",
            ],
            "{}",
            ran.text
        );
        assert_eq!(report.tests[1].message, "assert 1 == 2");
        assert!(report.tests[5].message.contains("1 == 1"), "the failing subtest: {}", report.tests[5].message);
        assert_eq!(report.tests[6].phase, Some("teardown"));
        assert!(!report.stopped_early());
        assert_eq!(report.collected.as_ref().map(Vec::len), Some(7));
        assert!(ran.text.contains("test session starts"), "pytest's own output is unchanged: {}", ran.text);

        // One parameterised case (which zsh would take for a pattern) and one test that is gone.
        let ran = run_pytest(&python, &dir, &["tests/test_real.py::test_p[1-2]", "tests/test_real.py::test_renamed"]);
        assert_eq!(statuses(&ran.report), ["Failed tests/test_real.py::test_p[1-2]"], "{}", ran.text);
        assert_eq!(ran.report.collected, Some(vec!["tests/test_real.py::test_p[1-2]".to_string()]));
        assert!(!ran.report.stopped_early());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_pytest_ini_above_the_folder_does_not_move_the_ids() {
        let Some(python) = python_with_pytest() else {
            eprintln!("skipped: python3 has no pytest here");
            return;
        };
        let parent = scratch("nested");
        let dir = parent.join("hw1");
        std::fs::create_dir_all(dir.join("tests")).unwrap();
        std::fs::write(parent.join("pytest.ini"), "[pytest]\n").unwrap();
        std::fs::write(dir.join("tests/test_n.py"), "def test_n():\n    assert 0\n").unwrap();
        let ran = run_pytest(&python, &dir, &["tests/test_n.py::test_n"]);
        assert_eq!(statuses(&ran.report), ["Failed tests/test_n.py::test_n"], "{}", ran.text);
        let at = ran.report.tests[0].at.as_ref().unwrap();
        assert_eq!(at.rel.as_deref(), Some("tests/test_n.py"), "the link opens the file");
        std::fs::remove_dir_all(&parent).unwrap();
    }

    #[test]
    fn runs_that_end_partway_never_look_complete() {
        let Some(python) = python_with_pytest() else {
            eprintln!("skipped: python3 has no pytest here");
            return;
        };
        let cases = [
            ("os._exit(0)", "import os\n    os._exit(0)", "exit code 0"),
            ("a segfault", "import ctypes\n    ctypes.string_at(0)", "signal 11"),
            ("pytest.exit", "import pytest\n    pytest.exit('bye')", "bye"),
            ("KeyboardInterrupt", "raise KeyboardInterrupt", "KeyboardInterrupt"),
        ];
        for (name, body, said) in cases {
            let dir = scratch("crash");
            let source = format!("def test_first():\n    pass\n\ndef test_crash():\n    {body}\n\ndef test_after():\n    pass\n");
            std::fs::write(dir.join("test_c.py"), source).unwrap();
            let mut ran = run_pytest(&python, &dir, &[]);
            assert!(ran.report.stopped_early(), "{name}: {}", ran.text);
            ran.report.end(ran.exit);
            let got = statuses(&ran.report);
            assert_eq!(got, ["Passed test_c.py::test_first", "Error test_c.py::test_crash"], "{name}: {}", ran.text);
            let crash = &ran.report.tests[1];
            assert!(crash.message.contains(said), "{name}: {}", crash.message);
            std::fs::remove_dir_all(&dir).unwrap();
        }
    }
}
