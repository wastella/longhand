//! The integrated terminals: up to four login shells on pseudo-terminals, started in the open
//! folder. The interface names each terminal with its own id, so it can recognise the first
//! output of a terminal before `term_start` has returned.

mod output;
mod process;

use crate::workspace::{workspace, AppState, R};
use output::{Flow, Output};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

pub const MAX_TERMINALS: usize = 4;

/// The open terminals, by the interface's id for each.
#[derive(Default)]
pub struct Term {
    sessions: HashMap<String, Session>,
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    /// The shell's pid, which is also its session id and process group.
    pid: i32,
    flow: Arc<Flow>,
}

fn with_term<T>(state: &AppState, f: impl FnOnce(&mut Term) -> T) -> T {
    f(state.term.lock().unwrap().get_or_insert_with(Term::default))
}

fn with_session<T>(state: &AppState, id: &str, f: impl FnOnce(&mut Session) -> T) -> Option<T> {
    with_term(state, |t| t.sessions.get_mut(id).map(f))
}

/// Stops every terminal and everything running in them, for quitting or opening another folder.
pub fn kill(state: &AppState) {
    let sessions: Vec<Session> = with_term(state, |t| t.sessions.drain().map(|(_, s)| s).collect());
    process::terminate_sessions(&sessions.iter().map(|s| s.pid).collect::<Vec<_>>());
}

fn login_shell(cwd: Option<PathBuf>) -> CommandBuilder {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut cmd = CommandBuilder::new(shell);
    cmd.arg("-l");
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if std::env::var_os("LANG").is_none() {
        cmd.env("LANG", "en_US.UTF-8");
    }
    cmd
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 }
}

#[tauri::command]
pub fn term_start(app: AppHandle, state: State<AppState>, id: String, cols: u16, rows: u16) -> R<()> {
    let count = with_term(&state, |t| t.sessions.len());
    if count >= MAX_TERMINALS {
        return Err(format!("At most {MAX_TERMINALS} terminals can be open at once"));
    }
    let cwd = state.workspace.lock().unwrap().clone().or_else(|| std::env::var_os("HOME").map(Into::into));
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
    let child = pair.slave.spawn_command(login_shell(cwd)).map_err(|e| format!("Could not start the shell: {e}"))?;
    drop(pair.slave);
    let pid = child.process_id().ok_or("The shell did not start")? as i32;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let flow = Arc::new(Flow::default());

    let handle = app.clone();
    let key = id.clone();
    output::start(reader, child, flow.clone(), move |out| match out {
        Output::Data { text, bytes } => {
            let _ = handle.emit("term:data", json!({ "id": key, "data": text, "bytes": bytes }));
        }
        Output::Exit { code } => {
            let _ = handle.emit("term:exit", json!({ "id": key, "code": code }));
            // Jobs the shell left behind go with it, as when a terminal window closes.
            let state = handle.state::<AppState>();
            if let Some(session) = with_term(&state, |t| t.sessions.remove(&key)) {
                process::terminate_sessions(&[session.pid]);
            }
        }
    });
    with_term(&state, |t| t.sessions.insert(id, Session { master: pair.master, writer, pid, flow }));
    Ok(())
}

#[tauri::command]
pub fn term_input(state: State<AppState>, id: String, data: String) {
    with_session(&state, &id, |s| {
        let _ = s.writer.write_all(data.as_bytes());
        let _ = s.writer.flush();
    });
}

#[tauri::command]
pub fn term_resize(state: State<AppState>, id: String, cols: u16, rows: u16) {
    if cols > 0 && rows > 0 {
        with_session(&state, &id, |s| s.master.resize(size(cols, rows)));
    }
}

/// The interface has drawn `bytes` bytes of this terminal's output.
#[tauri::command]
pub fn term_ack(state: State<AppState>, id: String, bytes: usize) {
    with_session(&state, &id, |s| s.flow.ack(bytes));
}

/// Closes one terminal, stopping everything running in it.
#[tauri::command]
pub fn term_close(state: State<AppState>, id: String) {
    if let Some(session) = with_term(&state, |t| t.sessions.remove(&id)) {
        // Stopping can take a moment; the interface need not wait for it.
        std::thread::spawn(move || {
            process::terminate_sessions(&[session.pid]);
            drop(session);
        });
    }
}

/// The terminals running a command (anything in the foreground other than the shell itself),
/// as [{ id, command }], where command is the command line or null if it cannot be read.
#[tauri::command]
pub fn term_busy(state: State<AppState>) -> Vec<Value> {
    let foreground: Vec<(String, i32)> = with_term(&state, |t| {
        t.sessions
            .iter()
            .filter_map(|(id, s)| s.master.process_group_leader().filter(|&group| group != s.pid).map(|group| (id.clone(), group)))
            .collect()
    });
    foreground.into_iter().map(|(id, group)| json!({ "id": id, "command": process::command_line(group) })).collect()
}

/// The command line that runs the Python file `path` (relative to the open folder) in terminal `id`.
#[tauri::command]
pub fn term_run_command(state: State<AppState>, id: String, path: String) -> R<String> {
    let ws = workspace(&state)?;
    let rel = resolve_location(&ws, None, &path).ok_or_else(|| format!("{path} is not a file in this folder"))?;
    let cwd = with_session(&state, &id, |s| s.pid).and_then(process::cwd);
    Ok(run_file_command(&ws, &rel, cwd.as_deref()))
}

/// Resolves file paths printed in terminal `id` (tracebacks, pytest, compilers) to paths in the
/// open folder, or null for any that are not files inside it.
#[tauri::command]
pub fn term_resolve(state: State<AppState>, id: String, paths: Vec<String>) -> Vec<Option<String>> {
    let Ok(ws) = workspace(&state) else { return vec![None; paths.len()] };
    let cwd = with_session(&state, &id, |s| s.pid).and_then(process::cwd);
    paths.iter().map(|p| resolve_location(&ws, cwd.as_deref(), p)).collect()
}

/// `printed` as a path relative to the folder `ws`, if it names a file inside it. A relative
/// path is tried against the shell's directory first, then the folder.
fn resolve_location(ws: &Path, cwd: Option<&Path>, printed: &str) -> Option<String> {
    let printed = Path::new(printed);
    let candidates: Vec<PathBuf> = if printed.is_absolute() {
        vec![printed.to_path_buf()]
    } else {
        cwd.into_iter().chain([ws]).map(|base| base.join(printed)).collect()
    };
    let ws = ws.canonicalize().ok()?;
    candidates.into_iter().find_map(|path| {
        let real = path.canonicalize().ok().filter(|p| p.is_file())?;
        Some(real.strip_prefix(&ws).ok()?.to_string_lossy().into_owned())
    })
}

/// `uv run python` for a uv project, `python3` otherwise, run from the folder's root.
fn run_file_command(ws: &Path, rel: &str, shell_cwd: Option<&Path>) -> String {
    let uv = ws.join("pyproject.toml").is_file() || ws.join("uv.lock").is_file();
    let python = if uv { "uv run python" } else { "python3" };
    // A file named like an option must not be read as one.
    let file = if rel.starts_with('-') { format!("./{rel}") } else { rel.to_string() };
    let run = format!("{python} {}", shell_quote(&file));
    let elsewhere = shell_cwd.is_some_and(|cwd| cwd.canonicalize().ok() != ws.canonicalize().ok());
    if elsewhere {
        format!("cd {} && {run}", shell_quote(&ws.to_string_lossy()))
    } else {
        run
    }
}

fn shell_quote(s: &str) -> String {
    if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "@%+=:,./-_".contains(c)) {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::tests::temp_dir;
    use std::fs;

    #[test]
    fn quotes_paths_for_the_shell() {
        assert_eq!(shell_quote("stats/running.py"), "stats/running.py");
        assert_eq!(shell_quote("my file.py"), "'my file.py'");
        assert_eq!(shell_quote("it's.py"), r"'it'\''s.py'");
        assert_eq!(shell_quote("$(rm -rf ~).py"), "'$(rm -rf ~).py'");
        assert_eq!(shell_quote(""), "''");
    }

    #[test]
    fn runs_python_files_with_uv_in_a_uv_project() {
        let ws = temp_dir("run-file");
        assert_eq!(run_file_command(&ws, "train.py", None), "python3 train.py");
        fs::write(ws.join("uv.lock"), "").unwrap();
        assert_eq!(run_file_command(&ws, "my model/train.py", Some(&ws)), "uv run python 'my model/train.py'");
        assert_eq!(run_file_command(&ws, "-x.py", None), "uv run python ./-x.py");
        fs::remove_file(ws.join("uv.lock")).unwrap();
        fs::write(ws.join("pyproject.toml"), "").unwrap();
        assert_eq!(run_file_command(&ws, "a.py", None), "uv run python a.py");
        // A shell that has moved elsewhere goes back to the folder first.
        let sub = ws.join("sub");
        fs::create_dir(&sub).unwrap();
        assert_eq!(run_file_command(&ws, "a.py", Some(&sub)), format!("cd {} && uv run python a.py", shell_quote(&ws.to_string_lossy())));
        fs::remove_dir_all(ws).unwrap();
    }

    #[test]
    fn resolves_printed_paths_inside_the_folder_only() {
        let ws = temp_dir("resolve");
        fs::create_dir_all(ws.join("stats")).unwrap();
        fs::write(ws.join("stats/running.py"), "").unwrap();
        fs::write(ws.join("train.py"), "").unwrap();
        let outside = temp_dir("resolve-outside");
        fs::write(outside.join("secret.py"), "").unwrap();
        let real_ws = ws.canonicalize().unwrap();
        let sub = ws.join("stats");

        assert_eq!(resolve_location(&ws, None, "stats/running.py").as_deref(), Some("stats/running.py"));
        assert_eq!(resolve_location(&ws, None, "./train.py").as_deref(), Some("train.py"));
        assert_eq!(resolve_location(&ws, None, &real_ws.join("train.py").to_string_lossy()).as_deref(), Some("train.py"));
        // Relative to where the shell is, then to the folder.
        assert_eq!(resolve_location(&ws, Some(&sub), "running.py").as_deref(), Some("stats/running.py"));
        assert_eq!(resolve_location(&ws, Some(&sub), "train.py").as_deref(), Some("train.py"));
        assert_eq!(resolve_location(&ws, Some(&sub), "../train.py").as_deref(), Some("train.py"));
        // Not files in the folder.
        assert_eq!(resolve_location(&ws, None, "missing.py"), None);
        assert_eq!(resolve_location(&ws, None, "stats"), None);
        assert_eq!(resolve_location(&ws, None, &outside.join("secret.py").to_string_lossy()), None);
        assert_eq!(resolve_location(&ws, Some(&outside), "secret.py"), None);
        assert_eq!(resolve_location(&ws, None, "/usr/lib/python3.12/runpy.py"), None);
        fs::remove_dir_all(ws).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn a_busy_shell_reports_its_foreground_command() {
        let pair = native_pty_system().openpty(size(80, 24)).unwrap();
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-i");
        cmd.env("PS1", "$ ");
        cmd.env("ENV", "/dev/null");
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let shell = child.process_id().unwrap() as i32;
        // A terminal nobody reads cannot drain, and the shell would hang on exit.
        let mut reader = pair.master.try_clone_reader().unwrap();
        std::thread::spawn(move || std::io::copy(&mut reader, &mut std::io::sink()));
        let mut writer = pair.master.take_writer().unwrap();
        let wait_for = |busy: bool| {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            loop {
                let group = pair.master.process_group_leader();
                if group.is_some_and(|g| (g != shell) == busy) {
                    return group.unwrap();
                }
                assert!(std::time::Instant::now() < deadline, "the shell never became {}", if busy { "busy" } else { "idle" });
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
        };
        wait_for(false);
        writer.write_all(b"sleep 30\n").unwrap();
        let group = wait_for(true);
        assert_eq!(process::command_line(group).as_deref(), Some("sleep 30"));
        process::terminate_sessions(&[shell]);
        child.wait().unwrap();
    }
}
