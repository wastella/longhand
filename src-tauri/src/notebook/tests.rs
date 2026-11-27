use super::*;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver};
use std::time::Instant;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("longhand-nb-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.canonicalize().unwrap()
}

#[test]
fn the_script_runs_the_folders_python_with_quoted_paths() {
    assert_eq!(script(true, Path::new("/w/it's hw 1")), r#"exec uv run python -u -c "$LONGHAND_KERNEL_HELPER" '/w/it'\''s hw 1'"#);
    assert!(script(false, Path::new("/w")).starts_with("exec python3 -u -c "));
    let dir = scratch("uv");
    assert!(!uses_uv(&dir));
    std::fs::write(dir.join("pyproject.toml"), "").unwrap();
    assert!(uses_uv(&dir));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn the_helper_reaches_python_through_the_environment_not_a_file() {
    let command = command("/bin/sh", Path::new("/"), "true", false);
    let helper = command.get_envs().find(|(name, _)| *name == "LONGHAND_KERNEL_HELPER").and_then(|(_, value)| value);
    assert_eq!(helper.map(|v| v.to_string_lossy().into_owned()), Some(HELPER.to_string()));
}

#[test]
fn no_more_than_the_cap_of_kernels_start() {
    let mut running = HashMap::new();
    for i in 0..MAX_KERNELS {
        assert!(admit(&running, &format!("nb-{i}")).is_ok());
        let child = Command::new("true").stdin(Stdio::piped()).spawn().unwrap();
        let kernel = Kernel {
            pgid: 0,
            kernel: Arc::default(),
            stdin: {
                let mut child = child;
                child.stdin.take().unwrap()
            },
            flow: Arc::default(),
        };
        running.insert(format!("nb-{i}"), kernel);
    }
    let refused = admit(&running, "nb-more").unwrap_err();
    assert!(refused.starts_with("At most 3 notebooks can run Python at once. Close another notebook's tab"), "{refused}");
    running.remove("nb-0");
    assert!(admit(&running, "nb-1").unwrap_err().contains("already running"));
    assert!(admit(&running, "nb-more").is_ok());
}

/// A Python whose ipykernel loads: $LONGHAND_TEST_KERNEL_PYTHON (which must work: CI sets it so
/// these tests run there), or python3 when it has one.
fn kernel_python() -> Option<String> {
    let chosen = std::env::var("LONGHAND_TEST_KERNEL_PYTHON").ok();
    let candidate = chosen.clone().unwrap_or_else(|| "python3".into());
    let found = Command::new(&candidate).args(["-c", "import sys, ipykernel.kernelapp, jupyter_client; print(sys.executable)"]).output();
    let works = found.as_ref().is_ok_and(|f| f.status.success());
    assert!(works || chosen.is_none(), "LONGHAND_TEST_KERNEL_PYTHON={candidate} cannot load ipykernel: {found:?}");
    works.then(|| String::from_utf8_lossy(&found.unwrap().stdout).trim().to_string())
}

struct Helper {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<Value>,
    /// While true, the helper's output is not read, as when the window is behind.
    paused: Arc<std::sync::atomic::AtomicBool>,
}

impl Helper {
    /// Runs the helper as the app does (its own process group, the notebook's folder), with `python` and its `args`.
    fn start(python: &str, args: &[&str], cwd: &Path) -> Helper {
        Helper::start_with(python, args, cwd, &[])
    }

    fn start_with(python: &str, args: &[&str], cwd: &Path, envs: &[(&str, &str)]) -> Helper {
        let mut child = Command::new(python)
            .envs(envs.iter().copied())
            .args(args)
            .args(["-c", HELPER])
            .arg(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (send, lines) = channel();
        let paused = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let gate = paused.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                while gate.load(std::sync::atomic::Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(20));
                }
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    return;
                }
                let _ = send.send(serde_json::from_str(&line).unwrap());
            }
        });
        Helper { child, stdin, lines, paused }
    }

    fn say(&mut self, message: Value) {
        writeln!(self.stdin, "{message}").unwrap();
    }

    /// Messages until one of `kind` (for `run`, when given) arrives; panics after 60 seconds.
    fn until(&self, kind: &str, run: Option<&str>) -> Vec<Value> {
        let start = Instant::now();
        let mut seen = Vec::new();
        while start.elapsed() < Duration::from_secs(60) {
            let Ok(message) = self.lines.recv_timeout(Duration::from_secs(1)) else { continue };
            let done = message["type"] == kind && run.is_none_or(|r| message["run"] == r);
            seen.push(message);
            if done {
                return seen;
            }
        }
        panic!("no {kind} message; saw {seen:?}");
    }
}

const NO_INPUT_LINE: &str = "This cell asked for input, which notebooks in Longhand cannot give. Set the value in the code instead.";

fn outputs(messages: &[Value]) -> Vec<Value> {
    messages.iter().filter(|m| m["type"] == "output").map(|m| m["output"].clone()).collect()
}

#[test]
fn a_real_kernel_runs_cells_in_the_notebooks_folder() {
    let Some(python) = kernel_python() else {
        eprintln!("skipped: no Python with ipykernel here (set LONGHAND_TEST_KERNEL_PYTHON)");
        return;
    };
    let dir = scratch("real");
    let mut helper = Helper::start(&python, &["-u"], &dir);
    let ready = helper.until("ready", None);
    let kernel = ready.last().unwrap()["kernel"].as_i64().expect("the kernel's pid") as i32;

    helper.say(json!({ "op": "execute", "run": "a", "code": "import os\nprint('hi')\nos.getcwd()" }));
    let a = helper.until("done", Some("a"));
    assert!(a.iter().any(|m| m["type"] == "start" && m["count"] == 1), "{a:?}");
    let out = outputs(&a);
    assert_eq!(out[0]["text"], "hi\n");
    assert_eq!(out[1]["data"]["text/plain"], format!("'{}'", dir.display()));
    assert_eq!(a.last().unwrap()["status"], "ok");

    // An error aborts what was queued behind it, as in Jupyter.
    helper.say(json!({ "op": "execute", "run": "b", "code": "1/0" }));
    helper.say(json!({ "op": "execute", "run": "c", "code": "print('never')" }));
    let b = helper.until("done", Some("b"));
    assert_eq!(outputs(&b)[0]["ename"], "ZeroDivisionError");
    assert_eq!(b.last().unwrap()["status"], "error");
    assert_eq!(helper.until("done", Some("c")).last().unwrap()["status"], "aborted");

    // input() fails the cell with one readable line.
    helper.say(json!({ "op": "execute", "run": "d", "code": "name = input('Name? ')" }));
    let asked = helper.until("done", Some("d"));
    assert_eq!(outputs(&asked)[0]["traceback"], json!([NO_INPUT_LINE]));
    assert_eq!(asked.last().unwrap()["status"], "error");
    helper.say(json!({ "op": "execute", "run": "d2", "code": "name = 'Ada'" }));
    helper.until("done", Some("d2"));

    // An endless loop stops on an interrupt, and the kernel keeps its variables.
    helper.say(json!({ "op": "execute", "run": "e", "code": "while True:\n    pass" }));
    helper.until("start", Some("e"));
    std::thread::sleep(Duration::from_millis(300));
    helper.say(json!({ "op": "interrupt" }));
    assert_eq!(outputs(&helper.until("done", Some("e")))[0]["ename"], "KeyboardInterrupt");
    helper.say(json!({ "op": "execute", "run": "f", "code": "name" }));
    assert_eq!(outputs(&helper.until("done", Some("f")))[0]["data"]["text/plain"], "'Ada'");

    // A carriage-return progress bar and a huge print are bounded before they leave the helper.
    helper.say(json!({ "op": "execute", "run": "g", "code": "print('x' * 3_000_000)" }));
    let big = outputs(&helper.until("done", Some("g")));
    let text: String = big.iter().map(|o| o["text"].as_str().unwrap_or_default()).collect();
    assert!(text.len() < 2_100_000 && text.contains("Longhand left out"), "{}", text.len());

    // The kernel dying is reported, and the helper ends.
    helper.say(json!({ "op": "execute", "run": "h", "code": "import os; os._exit(3)" }));
    let died = helper.until("died", None);
    assert_eq!(died.last().unwrap()["code"], 3);
    let status = helper.child.wait().unwrap();
    assert!(status.success());
    std::thread::sleep(Duration::from_millis(300));
    assert!(unsafe { libc::kill(kernel, 0) } != 0, "the kernel is gone");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn stopping_a_notebook_ends_the_helper_and_the_kernel() {
    let Some(python) = kernel_python() else {
        eprintln!("skipped: no Python with ipykernel here (set LONGHAND_TEST_KERNEL_PYTHON)");
        return;
    };
    let dir = scratch("stop");
    let mut helper = Helper::start(&python, &["-u"], &dir);
    let kernel = helper.until("ready", None).last().unwrap()["kernel"].as_i64().unwrap() as i32;
    helper.say(json!({ "op": "execute", "run": "a", "code": "import time\nwhile True:\n    time.sleep(1)" }));
    helper.until("start", Some("a"));
    let helper_group = helper.child.id() as i32;
    for group in [helper_group, kernel] {
        stop_group_now(group, Duration::from_secs(2));
    }
    let _ = helper.child.wait();
    std::thread::sleep(Duration::from_millis(200));
    assert!(unsafe { libc::kill(-helper_group, 0) } != 0, "the helper's group is gone");
    assert!(unsafe { libc::kill(-kernel, 0) } != 0, "the kernel's group is gone");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn stopping_before_the_kernel_is_ready_ends_it_too() {
    let Some(python) = kernel_python() else {
        eprintln!("skipped: no Python with ipykernel here (set LONGHAND_TEST_KERNEL_PYTHON)");
        return;
    };
    let dir = scratch("early");
    let mut helper = Helper::start(&python, &["-u"], &dir);
    // The kernel's process is named before it is ready, so the app can stop its group at once.
    let said = helper.until("kernel", None);
    assert!(said.iter().all(|m| m["type"] != "ready"), "{said:?}");
    let kernel = said.last().unwrap()["kernel"].as_i64().expect("the kernel's pid") as i32;
    // Even stopping only the helper's group (SIGTERM) takes the kernel with it.
    stop_group_now(helper.child.id() as i32, Duration::from_secs(5));
    let _ = helper.child.wait();
    let start = Instant::now();
    while unsafe { libc::kill(kernel, 0) } == 0 && start.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(unsafe { libc::kill(kernel, 0) } != 0, "the kernel is gone");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn an_interrupt_works_while_the_window_is_behind_on_a_flood_of_output() {
    let Some(python) = kernel_python() else {
        eprintln!("skipped: no Python with ipykernel here (set LONGHAND_TEST_KERNEL_PYTHON)");
        return;
    };
    let dir = scratch("flood");
    // A small backlog, so a few of the kernel's (already capped) messages are enough to fill it.
    let mut helper = Helper::start_with(&python, &["-u"], &dir, &[("LONGHAND_KERNEL_BACKLOG", "100000")]);
    helper.until("ready", None);
    helper.say(json!({ "op": "execute", "run": "a", "code": "while True:\n    print('x' * 1000, flush=True)" }));
    helper.until("start", Some("a"));
    // Stop reading, as the app does while the window catches up; the pipe fills.
    helper.paused.store(true, std::sync::atomic::Ordering::SeqCst);
    std::thread::sleep(Duration::from_secs(3));
    helper.say(json!({ "op": "interrupt" }));
    std::thread::sleep(Duration::from_secs(1));
    helper.paused.store(false, std::sync::atomic::Ordering::SeqCst);
    let run = helper.until("done", Some("a"));
    assert_eq!(run.last().unwrap()["status"], "error");
    let out = outputs(&run);
    assert!(out.iter().any(|o| o["ename"] == "KeyboardInterrupt"), "interrupted");
    assert!(
        out.iter().any(|o| o["text"].as_str().is_some_and(|t| t.contains("while the window caught up"))),
        "says what was left out: {} outputs, {:?}",
        out.len(),
        out.iter().map(|o| (o["output_type"].clone(), o["text"].as_str().map(str::len))).collect::<Vec<_>>()
    );
    // And the kernel still runs cells afterwards.
    helper.say(json!({ "op": "execute", "run": "b", "code": "1 + 1" }));
    assert_eq!(outputs(&helper.until("done", Some("b")))[0]["data"]["text/plain"], "2");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn a_python_without_ipykernel_gets_the_command_that_installs_it() {
    let dir = scratch("missing");
    // -S leaves out site-packages, so ipykernel cannot be found whatever this machine has.
    let mut helper = Helper::start("python3", &["-u", "-S"], &dir);
    let said = helper.until("problem", None);
    let problem = said.last().unwrap();
    assert_eq!(problem["kind"], "no-ipykernel");
    assert_eq!(problem["fix"], "python3 -m pip install ipykernel");
    assert!(!helper.child.wait().unwrap().success());
    std::fs::remove_dir_all(dir).unwrap();
}
