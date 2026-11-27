//! Notebook kernels: one Python kernel per open notebook, in the folder's own environment.
//!
//! The kernel is ipykernel, started by a small helper (notebook/kernel.py) that runs with the
//! folder's Python, found as the test runner finds it (`uv run python` when the folder has a
//! pyproject.toml or uv.lock, `python3` otherwise), from the student's login shell. The helper
//! speaks jupyter_client to the kernel and line-delimited JSON to us over stdio (its protocol is
//! at the top of kernel.py), so this side needs no ZeroMQ. Each line goes to the interface as
//! `notebook:message` `{ id, message, bytes }`; the interface acknowledges with `notebook_ack`,
//! and reading stops while too much is unacknowledged, so a cell printing without end cannot
//! swamp the window. When the helper ends, `notebook:exit` `{ id, code, signal, problem, kernel }`
//! says how: `problem` (`{ kind, title, detail, fix }`) when the kernel could not start, `kernel`
//! (`{ code, signal }`) when the kernel itself died.
//!
//! The helper runs in a process group of its own; jupyter_client starts the kernel in a session
//! (and so a group) of its own too. Stopping a notebook stops both groups, which takes anything
//! the kernel started (DataLoader workers, subprocesses) with them.

mod problem;

use crate::files::resolve_in;
use crate::pytest::{login_shell, shell_quote, stop_group, stop_group_now};
use crate::term::output::Flow;
use crate::workspace::{workspace, AppState, R};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

const HELPER: &str = include_str!("notebook/kernel.py");
const HELPER_NAME: &str = "longhand_kernel.py";
/// How many notebooks may have a kernel at once. Each holds its own Python with everything it
/// imported (a PyTorch kernel takes hundreds of megabytes), so a few is plenty.
pub const MAX_KERNELS: usize = 3;
/// How much of the helper's error output is kept for explaining a failed start.
const STDERR_TAIL: usize = 16 * 1024;
const STOP_GRACE: Duration = Duration::from_secs(2);

struct Kernel {
    /// The helper's process group (the shell, uv, Python).
    pgid: i32,
    /// The kernel's process group, once the helper has said which it is.
    kernel: Arc<Mutex<Option<i32>>>,
    stdin: ChildStdin,
    flow: Arc<Flow>,
}

impl Kernel {
    fn groups(&self) -> Vec<i32> {
        let mut groups = vec![self.pgid];
        groups.extend(*self.kernel.lock().unwrap());
        groups
    }
}

/// The running kernels, by the interface's id for each notebook.
#[derive(Default)]
pub struct Kernels(Mutex<HashMap<String, Kernel>>);

/// Stops every kernel in the background, for when another folder opens.
pub fn stop_all(app: &AppHandle) {
    let kernels: Vec<Kernel> = app.state::<Kernels>().0.lock().unwrap().drain().map(|(_, k)| k).collect();
    for kernel in kernels {
        kernel.groups().into_iter().for_each(stop_group);
    }
}

/// Stops every kernel and waits until they are gone, for quitting; then removes the helper.
pub fn shutdown(app: &AppHandle) {
    let kernels: Vec<Kernel> = app.state::<Kernels>().0.lock().unwrap().drain().map(|(_, k)| k).collect();
    for group in kernels.iter().flat_map(Kernel::groups) {
        stop_group_now(group, STOP_GRACE);
    }
    let _ = std::fs::remove_dir_all(helper_dir());
}

fn helper_dir() -> PathBuf {
    std::env::temp_dir().join(format!("longhand-notebook-{}", std::process::id()))
}

/// Writes the helper where Python can run it, once per app run.
fn install_helper() -> std::io::Result<PathBuf> {
    static INSTALLED: OnceLock<PathBuf> = OnceLock::new();
    if let Some(path) = INSTALLED.get() {
        if path.exists() {
            return Ok(path.clone());
        }
    }
    let dir = helper_dir();
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(HELPER_NAME);
    std::fs::write(&path, HELPER)?;
    Ok(INSTALLED.get_or_init(|| path.clone()).clone())
}

pub(crate) fn uses_uv(folder: &Path) -> bool {
    folder.join("pyproject.toml").is_file() || folder.join("uv.lock").is_file()
}

/// The command the helper's shell runs: the folder's Python with the helper and the notebook's folder.
fn script(uv: bool, helper: &Path, cwd: &Path) -> String {
    let python = if uv { "uv run python" } else { "python3" };
    format!("exec {python} -u {} {}", shell_quote(&helper.to_string_lossy()), shell_quote(&cwd.to_string_lossy()))
}

/// The helper's process: the login shell, so tools resolve as in the terminal, handing over to
/// /bin/sh for the script, in the folder, in a process group of its own.
fn command(shell: &str, folder: &Path, script: &str, uv: bool) -> Command {
    let mut command = Command::new(shell);
    command
        .args(["-lc", "exec /bin/sh -c \"$LONGHAND_KERNEL_SCRIPT\""])
        .current_dir(folder)
        .env("LONGHAND_KERNEL_SCRIPT", script)
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    if uv {
        command.env("LONGHAND_UV", "1");
    } else {
        command.env_remove("LONGHAND_UV");
    }
    command
}

/// Starts the kernel for notebook `id` (the interface's id), whose file is `path`. Its working
/// folder is the notebook's own folder.
#[tauri::command]
pub fn notebook_start(app: AppHandle, state: State<AppState>, kernels: State<Kernels>, id: String, path: String) -> R<()> {
    let folder = workspace(&state)?;
    let file = resolve_in(&folder, &path)?;
    let cwd = file.parent().map(Path::to_path_buf).unwrap_or_else(|| folder.clone());
    let helper = install_helper().map_err(|e| format!("Could not prepare the kernel: {e}"))?;
    let uv = uses_uv(&folder);
    let mut map = kernels.0.lock().unwrap();
    if map.len() >= MAX_KERNELS {
        return Err(format!(
            "At most {MAX_KERNELS} notebooks can run Python at once. Close another notebook's tab (or shut its kernel down), then run this cell again."
        ));
    }
    if map.contains_key(&id) {
        return Err(format!("A kernel called {id} is already running"));
    }
    let mut child =
        command(&login_shell(), &folder, &script(uv, &helper, &cwd), uv).spawn().map_err(|e| format!("Could not start the shell: {e}"))?;
    let kernel = Kernel {
        pgid: child.id() as i32,
        kernel: Arc::default(),
        stdin: child.stdin.take().expect("stdin is piped"),
        flow: Arc::default(),
    };
    let (flow, kernel_group) = (kernel.flow.clone(), kernel.kernel.clone());
    map.insert(id.clone(), kernel);
    drop(map);
    std::thread::spawn(move || follow(app, id, child, flow, kernel_group, uv));
    Ok(())
}

/// Relays the helper's lines until it ends, then says how it ended.
fn follow(app: AppHandle, id: String, mut child: Child, flow: Arc<Flow>, kernel_group: Arc<Mutex<Option<i32>>>, uv: bool) {
    let stderr = {
        let mut pipe = child.stderr.take().expect("stderr is piped");
        std::thread::spawn(move || {
            let mut tail = Vec::new();
            let mut buf = [0u8; 8192];
            while let Ok(n @ 1..) = pipe.read(&mut buf) {
                tail.extend_from_slice(&buf[..n]);
                if tail.len() > STDERR_TAIL {
                    tail.drain(..tail.len() - STDERR_TAIL);
                }
            }
            String::from_utf8_lossy(&tail).into_owned()
        })
    };
    let mut seen = Seen::default();
    let reader = BufReader::new(child.stdout.take().expect("stdout is piped"));
    for line in reader.split(b'\n').map_while(Result::ok) {
        let Ok(message) = serde_json::from_slice::<Value>(&line) else { continue };
        seen.note(&message);
        if let Some(pid) = message.get("kernel").and_then(Value::as_i64).filter(|_| message["type"] == "ready") {
            *kernel_group.lock().unwrap() = Some(pid as i32);
        }
        flow.wait_for_room();
        flow.sent(line.len());
        let _ = app.emit("notebook:message", json!({ "id": id, "message": message, "bytes": line.len() }));
    }
    let status = child.wait().ok();
    let stderr = stderr.join().unwrap_or_default();
    // Gone from the list already when the interface stopped it; then it hears nothing more.
    let ours = app.state::<Kernels>().0.lock().unwrap().remove(&id);
    if let Some(group) = *kernel_group.lock().unwrap() {
        stop_group(group);
    }
    let Some(kernel) = ours else { return };
    stop_group(kernel.pgid);
    let code = status.and_then(|s| s.code());
    let signal = status.and_then(|s| s.signal());
    let problem = if seen.ready {
        None
    } else {
        Some(match seen.problem.clone() {
            Some(said) => problem::with_output(said, &stderr),
            None => problem::diagnose(uv, code, &stderr),
        })
    };
    let _ = app.emit("notebook:exit", json!({ "id": id, "code": code, "signal": signal, "problem": problem, "kernel": seen.died }));
}

/// What the helper said that matters once it has ended.
#[derive(Default)]
struct Seen {
    ready: bool,
    problem: Option<Value>,
    died: Option<Value>,
}

impl Seen {
    fn note(&mut self, message: &Value) {
        match message["type"].as_str() {
            Some("ready") => self.ready = true,
            Some("problem") => self.problem = Some(message.clone()),
            Some("died") => self.died = Some(json!({ "code": message["code"], "signal": message["signal"] })),
            _ => {}
        }
    }
}

/// Sends `message` (see kernel.py) to notebook `id`'s kernel.
#[tauri::command]
pub fn notebook_send(kernels: State<Kernels>, id: String, message: Value) -> R<()> {
    let mut map = kernels.0.lock().unwrap();
    let kernel = map.get_mut(&id).ok_or("The kernel is not running")?;
    let line = format!("{}\n", serde_json::to_string(&message).map_err(|e| e.to_string())?);
    kernel.stdin.write_all(line.as_bytes()).and_then(|_| kernel.stdin.flush()).map_err(|e| format!("Could not reach the kernel: {e}"))
}

/// The interface has handled `bytes` bytes of notebook `id`'s messages.
#[tauri::command]
pub fn notebook_ack(kernels: State<Kernels>, id: String, bytes: usize) {
    if let Some(kernel) = kernels.0.lock().unwrap().get(&id) {
        kernel.flow.ack(bytes);
    }
}

/// Stops notebook `id`'s kernel and everything it started.
#[tauri::command]
pub fn notebook_stop(kernels: State<Kernels>, id: String) {
    let kernel = kernels.0.lock().unwrap().remove(&id);
    if let Some(kernel) = kernel {
        kernel.groups().into_iter().for_each(stop_group);
    }
}

#[cfg(test)]
mod tests;
