use super::*;
use std::sync::mpsc::{channel, Receiver};
use std::time::Instant;

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("longhand-nb-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.canonicalize().unwrap()
}

#[test]
fn the_script_runs_the_folders_python_with_quoted_paths() {
    let helper = Path::new("/tmp/it's here/longhand_kernel.py");
    assert_eq!(script(true, helper, Path::new("/w/hw 1")), r"exec uv run python -u '/tmp/it'\''s here/longhand_kernel.py' '/w/hw 1'");
    assert!(script(false, helper, Path::new("/w")).starts_with("exec python3 -u "));
    let dir = scratch("uv");
    assert!(!uses_uv(&dir));
    std::fs::write(dir.join("pyproject.toml"), "").unwrap();
    assert!(uses_uv(&dir));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn the_helper_is_written_once_and_rewritten_if_removed() {
    let path = install_helper().unwrap();
    assert_eq!(std::fs::read_to_string(&path).unwrap(), HELPER);
    std::fs::remove_file(&path).unwrap();
    assert_eq!(install_helper().unwrap(), path);
    assert!(path.exists());
}

/// A Python whose ipykernel loads: $LONGHAND_TEST_KERNEL_PYTHON, or python3 when it has one.
fn kernel_python() -> Option<String> {
    let candidate = std::env::var("LONGHAND_TEST_KERNEL_PYTHON").unwrap_or_else(|_| "python3".into());
    let found =
        Command::new(&candidate).args(["-c", "import sys, ipykernel.kernelapp, jupyter_client; print(sys.executable)"]).output().ok()?;
    found.status.success().then(|| String::from_utf8_lossy(&found.stdout).trim().to_string())
}

struct Helper {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<Value>,
}

impl Helper {
    /// Runs the helper as the app does (its own process group, the notebook's folder), with `python` and its `args`.
    fn start(python: &str, args: &[&str], cwd: &Path) -> Helper {
        let helper = install_helper().unwrap();
        let mut child = Command::new(python)
            .args(args)
            .arg(&helper)
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
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = send.send(serde_json::from_str(&line).unwrap());
            }
        });
        Helper { child, stdin, lines }
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
