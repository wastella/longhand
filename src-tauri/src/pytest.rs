//! Runs the workspace's pytest suite and turns its output into a list of results.

use crate::workspace::{log_event, workspace, AppState};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct TestRun {
    pid: Option<i32>,
    generation: u64,
    cancelled: bool,
}

pub fn cancel(state: &AppState) {
    let mut run = state.tests.lock().unwrap();
    if let Some(pid) = run.pid.take() {
        run.cancelled = true;
        // The run has its own process group, so this also stops uv and pytest.
        unsafe { libc::kill(-pid, libc::SIGTERM) };
    }
}

fn shell_quote(s: &str) -> String {
    if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "@%+=:,./-_[]".contains(c)) {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
    }
}

pub fn parse(output: &str) -> Value {
    let line = Regex::new(r"(?m)^(PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)\s+(\S+)(?:\s+-\s+(.*))?$").unwrap();
    let section = Regex::new(r"(?m)^_{3,} (.+?) _{3,}$").unwrap();
    let summary_head = Regex::new(r"(?m)^=+ short test summary info =+$").unwrap();
    let summary_line = Regex::new(r"(?m)^=+ (.*(?:passed|failed|error|skipped|no tests ran).*) =+$").unwrap();
    let quiet_summary = Regex::new(r"(?m)^(\d+ (?:passed|failed|error|skipped).*in [\d.]+s.*)$").unwrap();

    // Tracebacks sit in sections headed "____ name ____" before the short summary.
    let end_all = summary_head.find(output).map(|m| m.start()).unwrap_or(output.len());
    let marks: Vec<(String, usize)> = section.captures_iter(output).map(|c| (c[1].to_string(), c.get(0).unwrap().start())).collect();
    let mut details: HashMap<String, String> = HashMap::new();
    for (i, (name, start)) in marks.iter().enumerate() {
        let end = marks.get(i + 1).map(|m| m.1).unwrap_or(end_all).max(*start);
        let key = name.trim_start_matches("ERROR at setup of ").trim_start_matches("ERROR at teardown of ").to_string();
        details.entry(key).or_insert_with(|| output[*start..end].trim().to_string());
    }

    let mut seen = HashSet::new();
    let mut tests = Vec::new();
    for c in line.captures_iter(output) {
        let id = c[2].to_string();
        if !id.contains("::") && !id.contains('/') && !id.ends_with(".py") {
            continue;
        }
        if !seen.insert(id.clone()) {
            continue;
        }
        let parts: Vec<&str> = id.split("::").collect();
        let dotted = parts[1..].join(".");
        let detail = details.get(&dotted).or_else(|| details.get(*parts.last().unwrap())).cloned().unwrap_or_default();
        tests.push(json!({
            "status": &c[1],
            "id": id,
            "message": c.get(3).map(|m| m.as_str()).unwrap_or(""),
            "detail": detail,
        }));
    }
    let summary = summary_line.captures(output).or_else(|| quiet_summary.captures(output)).map(|c| c[1].to_string()).unwrap_or_default();
    json!({ "tests": tests, "summary": summary })
}

#[tauri::command]
pub fn tests_run(app: AppHandle, state: State<AppState>, target: Option<String>) -> Result<String, String> {
    let ws = workspace(&state)?;
    cancel(&state);

    let mut args = vec!["-rA".to_string(), "--tb=short".into(), "-q".into(), "--color=no".into()];
    if let Some(t) = target.as_deref().filter(|t| !t.is_empty()) {
        args.push(t.to_string());
    }
    let quoted: Vec<String> = args.iter().map(|a| shell_quote(a)).collect();
    let uses_uv = ws.join("uv.lock").exists() || ws.join("pyproject.toml").exists();
    let runner = if uses_uv { "uv run pytest" } else { "python3 -m pytest" };
    let command = format!("{runner} {}", quoted.join(" "));
    log_event(&ws, "tests", json!({ "target": target.clone().unwrap_or_else(|| "all".into()) }));

    // A login shell, so uv and python resolve the way they do in the user's terminal.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut child = Command::new(shell)
        .args(["-lc", &format!("{command} 2>&1")])
        .current_dir(&ws)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|e| e.to_string())?;

    let generation = {
        let mut run = state.tests.lock().unwrap();
        run.generation += 1;
        run.pid = Some(child.id() as i32);
        run.cancelled = false;
        run.generation
    };

    let cmd_for_event = command.clone();
    std::thread::spawn(move || {
        let mut out = child.stdout.take().unwrap();
        let mut all: Vec<u8> = Vec::new();
        let mut buf = [0u8; 8192];
        while let Ok(n) = out.read(&mut buf) {
            if n == 0 {
                break;
            }
            all.extend_from_slice(&buf[..n]);
            let _ = app.emit("tests:output", String::from_utf8_lossy(&buf[..n]).to_string());
        }
        let code = child.wait().ok().and_then(|s| s.code());
        let state = app.state::<AppState>();
        let cancelled = {
            let mut run = state.tests.lock().unwrap();
            if run.generation != generation {
                return; // a newer run replaced this one
            }
            run.pid = None;
            run.cancelled
        };
        let output = String::from_utf8_lossy(&all).to_string();
        let mut done = parse(&output);
        done["command"] = json!(cmd_for_event);
        done["code"] = json!(code);
        done["cancelled"] = json!(cancelled);
        done["output"] = json!(output);
        let _ = app.emit("tests:done", done);
    });
    Ok(command)
}

#[tauri::command]
pub fn tests_cancel(state: State<AppState>) {
    cancel(&state);
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn parses_results_and_tracebacks() {
        let out = "\
F.                                                                       [100%]
=================================== FAILURES ===================================
__________________________________ test_add ___________________________________
tests/test_m.py:5: in test_add
    assert add(1, 2) == 4
E   assert 3 == 4
=========================== short test summary info ============================
PASSED tests/test_m.py::test_ok
FAILED tests/test_m.py::test_add - assert 3 == 4
1 failed, 1 passed in 0.02s
";
        let v = parse(out);
        let tests = v["tests"].as_array().unwrap();
        assert_eq!(tests.len(), 2);
        assert_eq!(tests[1]["status"], "FAILED");
        assert_eq!(tests[1]["message"], "assert 3 == 4");
        assert!(tests[1]["detail"].as_str().unwrap().contains("E   assert 3 == 4"));
        assert_eq!(tests[0]["detail"], "");
        assert_eq!(v["summary"], "1 failed, 1 passed in 0.02s");
    }

    #[test]
    fn collection_errors_and_empty_runs() {
        let out = "\
==================================== ERRORS ====================================
_____________________ ERROR collecting tests/test_m.py ______________________
ImportError while importing test module
=========================== short test summary info ============================
ERROR tests/test_m.py
!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
1 error in 0.05s
";
        let v = parse(out);
        assert_eq!(v["tests"][0]["status"], "ERROR");
        assert_eq!(v["tests"][0]["id"], "tests/test_m.py");
        assert_eq!(v["summary"], "1 error in 0.05s");

        let empty = parse("no tests ran in 0.00s\n");
        assert_eq!(empty["tests"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn class_based_tests_find_their_traceback() {
        let out = "\
=================================== FAILURES ===================================
_____________________________ TestMath.test_square _____________________________
tests/test_m.py:9: in test_square
    assert square(3) == 9
E   assert 6 == 9
=========================== short test summary info ============================
FAILED tests/test_m.py::TestMath::test_square - assert 6 == 9
1 failed in 0.01s
";
        let v = parse(out);
        assert!(v["tests"][0]["detail"].as_str().unwrap().contains("assert 6 == 9"));
    }

    #[test]
    fn quoting_protects_odd_test_ids() {
        use super::shell_quote;
        assert_eq!(shell_quote("tests/test_m.py::test_a[1-2]"), "tests/test_m.py::test_a[1-2]");
        assert_eq!(shell_quote("my tests/t.py"), "'my tests/t.py'");
        assert_eq!(shell_quote("a'b; rm -rf x"), r"'a'\''b; rm -rf x'");
    }
}
