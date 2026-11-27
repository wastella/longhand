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

fn take_all(state: &AppState) -> Vec<Session> {
    with_term(state, |t| t.sessions.drain().map(|(_, s)| s).collect())
}

fn pids(sessions: &[Session]) -> Vec<i32> {
    sessions.iter().map(|s| s.pid).collect()
}

/// Stops every terminal and everything running in them, for quitting or opening another folder.
pub fn kill(state: &AppState) {
    process::terminate_sessions(&pids(&take_all(state)));
}

/// Stops these terminals in the background; stopping can take a moment and nobody need wait.
fn stop_in_background(sessions: Vec<Session>) {
    if !sessions.is_empty() {
        std::thread::spawn(move || process::terminate_sessions(&pids(&sessions)));
    }
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

/// Starts `cmd` on a new pseudo-terminal as terminal `id`. The lock is held from the count
/// check to the insert, so two starts at once cannot open a fifth terminal.
fn start(state: &AppState, id: String, cmd: CommandBuilder, size: PtySize, sink: impl FnMut(Output) + Send + 'static) -> R<()> {
    let mut guard = state.term.lock().unwrap();
    let term = guard.get_or_insert_with(Term::default);
    if term.sessions.len() >= MAX_TERMINALS {
        return Err(format!("At most {MAX_TERMINALS} terminals can be open at once"));
    }
    if term.sessions.contains_key(&id) {
        return Err(format!("A terminal called {id} is already open"));
    }
    let session = spawn(cmd, size, sink)?;
    term.sessions.insert(id, session);
    Ok(())
}

fn spawn(cmd: CommandBuilder, size: PtySize, sink: impl FnMut(Output) + Send + 'static) -> R<Session> {
    let pair = native_pty_system().openpty(size).map_err(|e| e.to_string())?;
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| format!("Could not start the shell: {e}"))?;
    drop(pair.slave);
    let master = pair.master;
    let parts = (|| -> R<_> {
        let pid = child.process_id().ok_or("The shell did not start")? as i32;
        let reader = master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = master.take_writer().map_err(|e| e.to_string())?;
        Ok((pid, reader, writer))
    })();
    let (pid, reader, writer) = match parts {
        Ok(parts) => parts,
        Err(e) => {
            // Close our end first: a shell cannot finish exiting while its output is undrained.
            drop(master);
            let _ = child.kill();
            let _ = child.wait();
            return Err(e);
        }
    };
    let flow = Arc::new(Flow::default());
    output::start(reader, child, flow.clone(), sink);
    Ok(Session { master, writer, pid, flow })
}

/// After terminal `id` exited by itself: forgets it, and stops any jobs the shell left behind,
/// as closing a terminal window would.
fn finish(state: &AppState, id: &str) {
    if let Some(session) = with_term(state, |t| t.sessions.remove(id)) {
        process::terminate_sessions(&[session.pid]);
    }
}

#[tauri::command]
pub fn term_start(app: AppHandle, state: State<AppState>, id: String, cols: u16, rows: u16) -> R<()> {
    let cwd = state.workspace.lock().unwrap().clone().or_else(|| std::env::var_os("HOME").map(Into::into));
    let key = id.clone();
    start(&state, id, login_shell(cwd), size(cols, rows), move |out| match out {
        Output::Data { text, bytes } => {
            let _ = app.emit("term:data", json!({ "id": key, "data": text, "bytes": bytes }));
        }
        Output::Exit { code } => {
            let _ = app.emit("term:exit", json!({ "id": key, "code": code }));
            finish(&app.state::<AppState>(), &key);
        }
    })
}

/// Stops every terminal. The interface calls it when it starts, so shells left by a page that
/// was reloaded do not run on unseen and count toward the limit.
#[tauri::command]
pub fn term_reset(state: State<AppState>) {
    stop_in_background(take_all(&state));
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
    close(&state, &id);
}

fn close(state: &AppState, id: &str) {
    stop_in_background(with_term(state, |t| t.sessions.remove(id)).into_iter().collect());
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
    run_file_command(&ws, &rel, cwd.as_deref())
}

/// Resolves file paths printed in terminal `id` (tracebacks, pytest, compilers) to paths in the
/// open folder, or null for any that are not files inside it. Async because it reads the disk
/// for every location on a hovered line.
#[tauri::command]
pub async fn term_resolve(state: State<'_, AppState>, id: String, paths: Vec<String>) -> R<Vec<Option<String>>> {
    let Ok(ws) = workspace(&state) else { return Ok(vec![None; paths.len()]) };
    let cwd = with_session(&state, &id, |s| s.pid).and_then(process::cwd);
    Ok(paths.iter().map(|p| resolve_location(&ws, cwd.as_deref(), p)).collect())
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
    let real_ws = ws.canonicalize().ok()?;
    candidates.into_iter().find_map(|path| {
        // Paths elsewhere are turned away without touching the disk; the check after resolving
        // catches `..` and links that lead out of the folder.
        if !(path.starts_with(ws) || path.starts_with(&real_ws)) {
            return None;
        }
        let real = path.canonicalize().ok().filter(|p| p.is_file())?;
        Some(real.strip_prefix(&real_ws).ok()?.to_string_lossy().into_owned())
    })
}

/// True when `text` has a character the terminal would take as a keystroke (Ctrl+C, Return,
/// Ctrl+U, Delete) rather than as part of a word. No quoting protects against those.
fn has_control(text: &str) -> bool {
    text.chars().any(|c| (c as u32) < 0x20 || c == '\u{7f}')
}

/// `uv run python` for a uv project, `python3` otherwise, run from the folder's root. The command
/// is typed into the shell, so a path with control characters is refused rather than typed.
fn run_file_command(ws: &Path, rel: &str, shell_cwd: Option<&Path>) -> R<String> {
    if has_control(rel) {
        return Err(
            "Its name contains a control character, which the terminal would take as a keystroke. Rename the file and try again.".into()
        );
    }
    let folder = ws.to_string_lossy();
    if has_control(&folder) {
        return Err("The folder's path contains a control character, which the terminal would take as a keystroke. Rename the folder and try again.".into());
    }
    let uv = ws.join("pyproject.toml").is_file() || ws.join("uv.lock").is_file();
    let python = if uv { "uv run python" } else { "python3" };
    // A file named like an option must not be read as one.
    let file = if rel.starts_with('-') { format!("./{rel}") } else { rel.to_string() };
    let run = format!("{python} {}", shell_quote(&file));
    // Unless the shell is known to be in the folder, go there first.
    let in_folder = shell_cwd.is_some_and(|cwd| cwd.canonicalize().ok() == ws.canonicalize().ok());
    Ok(if in_folder { run } else { format!("cd {} && {run}", shell_quote(&folder)) })
}

/// Quotes `s` as one shell word. A word starting with `=` is quoted too, so zsh does not expand
/// it to a command's path (`~` is never left bare either, so it is not taken as a home directory).
fn shell_quote(s: &str) -> String {
    let plain = !s.is_empty() && !s.starts_with('=') && s.chars().all(|c| c.is_ascii_alphanumeric() || "@%+=:,./-_".contains(c));
    if plain {
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
    use std::sync::mpsc::{channel, Receiver};
    use std::time::{Duration, Instant};

    #[test]
    fn quotes_paths_for_the_shell() {
        assert_eq!(shell_quote("stats/running.py"), "stats/running.py");
        assert_eq!(shell_quote("my file.py"), "'my file.py'");
        assert_eq!(shell_quote("it's.py"), r"'it'\''s.py'");
        assert_eq!(shell_quote("$(rm -rf ~).py"), "'$(rm -rf ~).py'");
        assert_eq!(shell_quote("=python.py"), "'=python.py'");
        assert_eq!(shell_quote("~root.py"), "'~root.py'");
        assert_eq!(shell_quote("a=b.py"), "a=b.py");
        assert_eq!(shell_quote(""), "''");
    }

    #[test]
    fn runs_python_files_with_uv_in_a_uv_project() {
        let ws = temp_dir("run-file");
        let run = |rel: &str, cwd: Option<&Path>| run_file_command(&ws, rel, cwd).unwrap();
        let cd = format!("cd {} && ", shell_quote(&ws.to_string_lossy()));
        assert_eq!(run("train.py", Some(&ws)), "python3 train.py");
        fs::write(ws.join("uv.lock"), "").unwrap();
        assert_eq!(run("my model/train.py", Some(&ws)), "uv run python 'my model/train.py'");
        assert_eq!(run("-x.py", Some(&ws)), "uv run python ./-x.py");
        fs::remove_file(ws.join("uv.lock")).unwrap();
        fs::write(ws.join("pyproject.toml"), "").unwrap();
        assert_eq!(run("a.py", Some(&ws)), "uv run python a.py");
        // A shell that has moved elsewhere, or whose directory cannot be read, goes back first.
        let sub = ws.join("sub");
        fs::create_dir(&sub).unwrap();
        assert_eq!(run("a.py", Some(&sub)), format!("{cd}uv run python a.py"));
        assert_eq!(run("a.py", None), format!("{cd}uv run python a.py"));
        fs::remove_dir_all(ws).unwrap();
    }

    #[test]
    fn refuses_to_type_control_characters() {
        let ws = temp_dir("run-control");
        for name in ["a\x03touch PWNED\r.py", "\x15touch PWNEDU x'.py", "a\x1b[A.py", "a\x7f.py", "a\nb.py", "a\tb.py"] {
            let refused = run_file_command(&ws, name, Some(&ws)).unwrap_err();
            assert!(refused.contains("Rename the file"), "{name:?}: {refused}");
        }
        let odd_folder = ws.join("course\x03work");
        let refused = run_file_command(&odd_folder, "a.py", Some(&ws)).unwrap_err();
        assert!(refused.contains("Rename the folder"));
        // Characters beyond ASCII are fine.
        assert_eq!(run_file_command(&ws, "données/é 世.py", Some(&ws)).unwrap(), "python3 'données/é 世.py'");
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
        assert_eq!(resolve_location(&ws, None, &ws.join("train.py").to_string_lossy()).as_deref(), Some("train.py"));
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
        let escape = format!("../{}/secret.py", outside.file_name().unwrap().to_string_lossy());
        assert_eq!(resolve_location(&ws, None, &escape), None);
        fs::remove_dir_all(ws).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    fn sh(script: &str) -> CommandBuilder {
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.args(["-c", script]);
        cmd
    }

    /// Starts `script` as terminal `id` the way term_start does, reporting its exit code once
    /// the terminal has been forgotten.
    fn start_sh(state: &Arc<AppState>, id: &str, script: &str) -> R<Receiver<Option<u32>>> {
        let (tx, rx) = channel();
        let (state2, key) = (state.clone(), id.to_string());
        start(state, id.into(), sh(script), size(80, 24), move |out| {
            if let Output::Exit { code } = out {
                finish(&state2, &key);
                let _ = tx.send(code);
            }
        })?;
        Ok(rx)
    }

    fn open_ids(state: &AppState) -> Vec<String> {
        let mut ids: Vec<String> = with_term(state, |t| t.sessions.keys().cloned().collect());
        ids.sort();
        ids
    }

    fn alive(pid: i32) -> bool {
        unsafe { libc::kill(pid, 0) == 0 }
    }

    fn pid_of(state: &AppState, id: &str) -> i32 {
        with_session(state, id, |s| s.pid).unwrap()
    }

    #[test]
    fn a_terminal_that_exits_reports_its_code_and_is_forgotten() {
        let state = Arc::new(AppState::default());
        let exit = start_sh(&state, "a", "exit 3").unwrap();
        assert_eq!(exit.recv_timeout(Duration::from_secs(10)).unwrap(), Some(3));
        assert!(open_ids(&state).is_empty());
    }

    #[test]
    fn closing_one_terminal_leaves_the_others_running() {
        let state = Arc::new(AppState::default());
        let a = start_sh(&state, "a", "sleep 30").unwrap();
        let _b = start_sh(&state, "b", "sleep 30").unwrap();
        let b_pid = pid_of(&state, "b");
        close(&state, "a");
        assert!(a.recv_timeout(Duration::from_secs(10)).is_ok(), "a stopped");
        assert_eq!(open_ids(&state), ["b"]);
        assert!(alive(b_pid));
        kill(&state);
    }

    #[test]
    fn at_most_four_terminals_and_a_reset_frees_them() {
        let state = Arc::new(AppState::default());
        for id in ["1", "2", "3", "4"] {
            start_sh(&state, id, "sleep 30").unwrap();
        }
        assert!(start_sh(&state, "5", "sleep 30").unwrap_err().contains("At most 4"));
        let shells: Vec<i32> = ["1", "2", "3", "4"].iter().map(|id| pid_of(&state, id)).collect();
        // What term_reset does when a reloaded page mounts.
        stop_in_background(take_all(&state));
        start_sh(&state, "fresh", "sleep 30").unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while shells.iter().any(|&pid| !process::session_members(pid).is_empty()) {
            assert!(Instant::now() < deadline, "the old shells were not stopped");
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(open_ids(&state), ["fresh"]);
        kill(&state);
    }

    #[test]
    fn a_terminal_id_cannot_be_used_twice() {
        let state = Arc::new(AppState::default());
        start_sh(&state, "a", "sleep 30").unwrap();
        assert!(start_sh(&state, "a", "sleep 30").unwrap_err().contains("already open"));
        kill(&state);
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
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                let group = pair.master.process_group_leader();
                if group.is_some_and(|g| (g != shell) == busy) {
                    return group.unwrap();
                }
                assert!(Instant::now() < deadline, "the shell never became {}", if busy { "busy" } else { "idle" });
                std::thread::sleep(Duration::from_millis(20));
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
