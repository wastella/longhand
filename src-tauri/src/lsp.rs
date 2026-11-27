//! Language servers: finds the one for a kind of code among what the student has installed
//! (`discover.rs`), runs it in the open folder (`process.rs`) and carries JSON-RPC messages
//! between it and the interface (`framing.rs`). The protocol itself lives in the interface
//! (`src/renderer/editor/`): this side never looks inside a message, and it is the interface
//! that decides whether to start a server again after it exits.
//!
//! At most one server runs per kind. Each is named by an id that is never reused, so messages
//! from a server that was replaced cannot be taken for its successor's.

mod discover;
mod framing;
mod probe;
mod process;
mod search_path;

use crate::workspace::{workspace, AppState, R};
use discover::{Found, Kind, Search};
use process::{Event, Server};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager, State};

/// The running servers, by id.
#[derive(Default)]
pub struct Lsp {
    servers: HashMap<u64, Running>,
}

struct Running {
    kind: Kind,
    server: Server,
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

// Stopping a server waits for its reader to finish handing over an event, and a reader
// reporting an exit takes the lock on `state.lsp`. So servers are always taken out of the map
// first and stopped after the lock is released.

fn take_all(state: &AppState) -> Vec<Server> {
    state.lsp.lock().unwrap().servers.drain().map(|(_, running)| running.server).collect()
}

fn take(state: &AppState, id: u64) -> Option<Server> {
    state.lsp.lock().unwrap().servers.remove(&id).map(|running| running.server)
}

/// Stops every server, for when another folder opens. Nothing more is heard from them.
pub fn kill(state: &AppState) {
    for server in take_all(state) {
        server.stop();
    }
}

/// Stops every server and waits until they are gone, for when the app quits.
pub fn shutdown(state: &AppState) {
    process::stop_all_now(&take_all(state));
}

/// Looks for `kind`'s server. A miss on the remembered search path is tried once more on a
/// fresh one, so a server installed a moment ago is found without restarting Longhand.
fn locate(kind: Kind, folder: &Path) -> Option<Found> {
    let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
    let virtual_env = std::env::var_os("VIRTUAL_ENV").filter(|dir| !dir.is_empty()).map(PathBuf::from);
    let look = |path: &str| discover::find(kind, &Search { folder, path, home: &home, virtual_env: virtual_env.as_deref() });
    look(&search_path::current()).or_else(|| look(&search_path::refreshed()?))
}

/// Starts `found` in `folder` as the server for `kind`, replacing the one running for that
/// kind if any, and returns what `lsp_start` answers. `on_event` gets the new server's id with
/// each of its events.
fn start(
    state: &AppState,
    kind: Kind,
    folder: &Path,
    found: Option<Found>,
    mut on_event: impl FnMut(u64, Event) + Send + 'static,
) -> R<Value> {
    let Some(found) = found else { return Ok(json!({ "status": "missing" })) };
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    // The lock is held from the folder check to the insert: a folder opened meanwhile either
    // is seen here or stops this server along with the rest, and a server that exits at once
    // cannot be forgotten before it is recorded.
    let mut lsp = state.lsp.lock().unwrap();
    if state.workspace.lock().unwrap().as_deref() != Some(folder) {
        return Err("Another folder was opened before the language server started".into());
    }
    let server = match process::spawn(found.command(folder), move |event| on_event(id, event)) {
        Ok(server) => server,
        Err(e) => {
            let message = format!(
                "{} is installed at {}, but it could not be started: {e}. Installing it again usually fixes this.",
                found.name,
                found.path.display()
            );
            return Ok(json!({ "status": "failed", "message": message }));
        }
    };
    let replaced: Vec<u64> = lsp.servers.iter().filter(|(_, running)| running.kind == kind).map(|(&id, _)| id).collect();
    let replaced: Vec<Running> = replaced.iter().filter_map(|id| lsp.servers.remove(id)).collect();
    lsp.servers.insert(id, Running { kind, server });
    drop(lsp);
    for old in replaced {
        old.server.stop();
    }
    Ok(json!({ "status": "started", "id": id, "server": found.name, "path": found.path, "root": folder, "python": found.python }))
}

fn send(state: &AppState, id: u64, message: &str) {
    if let Some(running) = state.lsp.lock().unwrap().servers.get(&id) {
        running.server.send(message);
    }
}

fn ack(state: &AppState, id: u64, bytes: usize) {
    if let Some(running) = state.lsp.lock().unwrap().servers.get(&id) {
        running.server.ack(bytes);
    }
}

fn stop(state: &AppState, id: u64) {
    if let Some(server) = take(state, id) {
        server.stop();
    }
}

/// Passes a server's event on to the interface, forgetting a server that has exited.
fn report(app: &AppHandle, id: u64, event: Event) {
    match event {
        Event::Message(message) => {
            let _ = app.emit("lsp:message", json!({ "id": id, "bytes": message.len(), "message": message }));
        }
        Event::Exit { code, stderr } => {
            drop(take(&app.state::<AppState>(), id));
            let _ = app.emit("lsp:exit", json!({ "id": id, "code": code, "stderr": stderr }));
        }
    }
}

/// Finds and starts the server for `kind` (`python`, `clang`, `java`, `typescript`, `rust` or
/// `go`) in the open folder. Answers `{ status: "started", id, server, path, root, python }`,
/// `{ status: "missing" }` when none is installed, or `{ status: "failed", message }` when one
/// was found but would not start. Looking can take a moment (it may start a login shell), so it
/// happens off the main thread.
#[tauri::command]
pub async fn lsp_start(app: AppHandle, kind: String) -> R<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let kind = Kind::parse(&kind).ok_or_else(|| format!("Longhand has no language server for \"{kind}\""))?;
        let folder = workspace(&state)?;
        let found = locate(kind, &folder);
        let events = app.clone();
        start(&state, kind, &folder, found, move |id, event| report(&events, id, event))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Sends one JSON-RPC message (without headers) to server `id`. Returns at once: the message
/// is queued, and a server that stops reading is ended and reported with `lsp:exit`.
#[tauri::command]
pub fn lsp_send(state: State<AppState>, id: u64, message: String) {
    send(&state, id, &message);
}

/// The interface has handled `bytes` bytes of server `id`'s `lsp:message` events.
#[tauri::command]
pub fn lsp_ack(state: State<AppState>, id: u64, bytes: usize) {
    ack(&state, id, bytes);
}

/// Stops server `id` and everything it started. No `lsp:exit` follows.
#[tauri::command]
pub fn lsp_stop(state: State<AppState>, id: u64) {
    stop(&state, id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::tests::temp_dir;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
    use std::time::Duration;

    const SOON: Duration = Duration::from_secs(10);

    /// A folder open in a fresh app state, whose `.venv` holds a stand-in Python server that
    /// runs `script`.
    fn folder_with_server(name: &str, script: &str) -> (AppState, PathBuf) {
        let folder = temp_dir(name).canonicalize().unwrap();
        let server = folder.join(".venv/bin/pylsp");
        fs::create_dir_all(server.parent().unwrap()).unwrap();
        fs::write(&server, format!("#!/bin/sh\n{script}\n")).unwrap();
        fs::set_permissions(&server, fs::Permissions::from_mode(0o755)).unwrap();
        let state = AppState::default();
        *state.workspace.lock().unwrap() = Some(folder.clone());
        (state, folder)
    }

    fn find_in(folder: &Path, kind: Kind) -> Option<Found> {
        discover::find(kind, &Search { folder, path: "", home: Path::new("/nonexistent"), virtual_env: None })
    }

    /// Starts the folder's stand-in server; returns `lsp_start`'s answer and the server's events.
    fn start_in(state: &AppState, folder: &Path) -> (Value, Receiver<(u64, Event)>) {
        let (tx, rx) = channel();
        let answer = start(state, Kind::Python, folder, find_in(folder, Kind::Python), move |id, event| {
            let _ = tx.send((id, event));
        });
        (answer.unwrap(), rx)
    }

    fn id_of(answer: &Value) -> u64 {
        assert_eq!(answer["status"], "started", "{answer}");
        answer["id"].as_u64().unwrap()
    }

    #[test]
    fn a_started_server_is_described_and_carries_messages_both_ways() {
        let (state, folder) = folder_with_server("lsp-start", "exec /bin/cat");
        fs::write(folder.join(".venv/bin/python"), "").unwrap();
        fs::set_permissions(folder.join(".venv/bin/python"), fs::Permissions::from_mode(0o755)).unwrap();
        let (answer, events) = start_in(&state, &folder);
        let id = id_of(&answer);
        assert_eq!(answer["server"], "pylsp");
        assert_eq!(answer["path"], json!(folder.join(".venv/bin/pylsp")));
        assert_eq!(answer["root"], json!(folder));
        assert_eq!(answer["python"], json!(folder.join(".venv/bin/python")));

        send(&state, id, "{\"id\":1}");
        assert_eq!(events.recv_timeout(SOON).unwrap(), (id, Event::Message("{\"id\":1}".into())));
        ack(&state, id, 8);
        kill(&state);
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn a_server_that_is_not_installed_is_missing_and_one_that_cannot_run_has_failed() {
        let (state, folder) = folder_with_server("lsp-missing", "exit 0");
        let nothing = |_: u64, _: Event| {};
        assert_eq!(start(&state, Kind::Java, &folder, find_in(&folder, Kind::Java), nothing).unwrap(), json!({ "status": "missing" }));

        // Found, then gone before it could be started.
        let found = find_in(&folder, Kind::Python);
        fs::remove_file(folder.join(".venv/bin/pylsp")).unwrap();
        let answer = start(&state, Kind::Python, &folder, found, nothing).unwrap();
        assert_eq!(answer["status"], "failed");
        let message = answer["message"].as_str().unwrap();
        assert!(message.starts_with("pylsp is installed at ") && message.contains("could not be started"), "{message}");
        assert!(state.lsp.lock().unwrap().servers.is_empty());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn starting_a_kind_again_replaces_its_server_under_a_new_id() {
        let (state, folder) = folder_with_server("lsp-replace", "exec /bin/cat");
        let (first, first_events) = start_in(&state, &folder);
        let (second, second_events) = start_in(&state, &folder);
        let (first, second) = (id_of(&first), id_of(&second));
        assert_ne!(first, second);
        assert_eq!(state.lsp.lock().unwrap().servers.keys().collect::<Vec<_>>(), [&second]);

        // The old id reaches nothing, and the old server ends without a word.
        send(&state, first, "{\"to\":\"old\"}");
        send(&state, second, "{\"to\":\"new\"}");
        assert_eq!(second_events.recv_timeout(SOON).unwrap(), (second, Event::Message("{\"to\":\"new\"}".into())));
        assert_eq!(first_events.recv_timeout(SOON), Err(RecvTimeoutError::Disconnected));
        kill(&state);
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn a_server_that_exits_is_reported_once_with_its_errors() {
        let (state, folder) = folder_with_server("lsp-exit", "echo 'pylsp: cannot import jedi' >&2; exit 2");
        let (answer, events) = start_in(&state, &folder);
        let id = id_of(&answer);
        assert_eq!(events.recv_timeout(SOON).unwrap(), (id, Event::Exit { code: Some(2), stderr: "pylsp: cannot import jedi\n".into() }));
        assert_eq!(events.recv_timeout(SOON), Err(RecvTimeoutError::Disconnected));
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn stopping_a_server_or_leaving_the_folder_ends_it_silently() {
        let (state, folder) = folder_with_server("lsp-stop", "exec /bin/cat");
        let (answer, stopped_events) = start_in(&state, &folder);
        stop(&state, id_of(&answer));
        assert_eq!(stopped_events.recv_timeout(SOON), Err(RecvTimeoutError::Disconnected), "no exit event after lsp_stop");

        let (answer, left_events) = start_in(&state, &folder);
        let id = id_of(&answer);
        kill(&state);
        assert!(state.lsp.lock().unwrap().servers.is_empty());
        send(&state, id, "{}");
        assert_eq!(left_events.recv_timeout(SOON), Err(RecvTimeoutError::Disconnected), "nothing from the folder that was left");

        let (answer, quit_events) = start_in(&state, &folder);
        id_of(&answer);
        shutdown(&state);
        assert_eq!(quit_events.recv_timeout(SOON), Err(RecvTimeoutError::Disconnected), "nothing while quitting");
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn a_server_is_not_started_for_a_folder_that_is_no_longer_open() {
        let (state, folder) = folder_with_server("lsp-left", "exec /bin/cat");
        *state.workspace.lock().unwrap() = Some(PathBuf::from("/another/folder"));
        let answer = start(&state, Kind::Python, &folder, find_in(&folder, Kind::Python), |_, _| {});
        assert!(answer.unwrap_err().contains("Another folder was opened"));
        assert!(state.lsp.lock().unwrap().servers.is_empty());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn unknown_ids_are_ignored() {
        let state = AppState::default();
        send(&state, 999_999, "{}");
        ack(&state, 999_999, 10);
        stop(&state, 999_999);
    }

    /// Waits for the message `wanted` picks out, passing over the others.
    fn message_where(events: &Receiver<(u64, Event)>, mut wanted: impl FnMut(&Value) -> bool) -> Value {
        loop {
            match events.recv_timeout(Duration::from_secs(60)).expect("the server answers within a minute").1 {
                Event::Message(text) => {
                    let message: Value = serde_json::from_str(&text).expect("every message is JSON");
                    if wanted(&message) {
                        return message;
                    }
                }
                Event::Exit { code, stderr } => panic!("the server exited early with {code:?}: {stderr}"),
            }
        }
    }

    /// The real thing, end to end: clangd as found on this machine, started the way the app
    /// starts it, reporting an error in a C file. Skipped where clangd is not installed.
    #[test]
    fn clangd_reports_an_error_in_a_c_file() {
        let folder = temp_dir("lsp-clangd").canonicalize().unwrap();
        let Some(found) = locate(Kind::Clang, &folder) else {
            fs::remove_dir_all(folder).unwrap();
            return eprintln!("skipped: clangd is not installed");
        };
        let state = AppState::default();
        *state.workspace.lock().unwrap() = Some(folder.clone());
        let (tx, events) = channel();
        let answer = start(&state, Kind::Clang, &folder, Some(found), move |id, event| {
            let _ = tx.send((id, event));
        });
        let answer = answer.unwrap();
        let id = id_of(&answer);
        assert_eq!(answer["server"], "clangd");
        let say = |message: Value| send(&state, id, &message.to_string());

        let root = format!("file://{}", folder.display());
        say(
            json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "processId": null, "rootUri": root, "capabilities": {} } }),
        );
        let initialized = message_where(&events, |m| m["id"] == 1);
        assert!(initialized["result"]["capabilities"].is_object(), "{initialized}");
        say(json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }));

        let uri = format!("{root}/main.c");
        let text = "int main(void) {\n  return undefined_name;\n}\n";
        fs::write(folder.join("main.c"), text).unwrap();
        say(json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didOpen",
            "params": { "textDocument": { "uri": uri, "languageId": "c", "version": 1, "text": text } }
        }));
        let published = message_where(&events, |m| {
            m["method"] == "textDocument/publishDiagnostics"
                && m["params"]["uri"] == uri.as_str()
                && m["params"]["diagnostics"].as_array().is_some_and(|d| !d.is_empty())
        });
        let diagnostic = &published["params"]["diagnostics"][0];
        assert!(diagnostic["message"].as_str().unwrap().contains("undefined_name"), "{diagnostic}");
        assert_eq!(diagnostic["range"]["start"]["line"], 1, "{diagnostic}");

        // An orderly goodbye: clangd answers `shutdown`, then exits by itself on `exit`.
        say(json!({ "jsonrpc": "2.0", "id": 2, "method": "shutdown", "params": null }));
        message_where(&events, |m| m["id"] == 2);
        say(json!({ "jsonrpc": "2.0", "method": "exit" }));
        let exit = loop {
            if let (_, Event::Exit { code, .. }) = events.recv_timeout(SOON).expect("clangd exits when told to") {
                break code;
            }
        };
        assert_eq!(exit, Some(0));
        fs::remove_dir_all(folder).unwrap();
    }

    /// The main use case, against a real Python project: a server installed in the folder's own
    /// `.venv` is found and started inside that environment, so a package installed there
    /// resolves while one installed nowhere does not. No protocol settings are sent, which
    /// leaves only the way the server is started to make it work. Runs when
    /// `LONGHAND_TEST_PYTHON_FOLDER` names a folder whose `.venv` has basedpyright or pyright
    /// and the `attrs` package (`uv venv && uv pip install basedpyright attrs`).
    #[test]
    fn a_python_server_resolves_imports_from_the_folders_environment() {
        let Some(folder) = std::env::var_os("LONGHAND_TEST_PYTHON_FOLDER").map(PathBuf::from) else {
            return eprintln!("skipped: LONGHAND_TEST_PYTHON_FOLDER is not set");
        };
        let folder = folder.canonicalize().unwrap();
        let found = locate(Kind::Python, &folder).expect("a server in the folder's .venv");
        assert!(found.path.starts_with(folder.join(".venv/bin")), "{}", found.path.display());
        let state = AppState::default();
        *state.workspace.lock().unwrap() = Some(folder.clone());
        let (tx, events) = channel();
        let answer = start(&state, Kind::Python, &folder, Some(found), move |id, event| {
            let _ = tx.send((id, event));
        })
        .unwrap();
        let id = id_of(&answer);
        assert_eq!(answer["python"], json!(folder.join(".venv/bin/python")));
        let say = |message: Value| send(&state, id, &message.to_string());

        let root = format!("file://{}", folder.display());
        say(
            json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "processId": null, "rootUri": root, "capabilities": {} } }),
        );
        message_where(&events, |m| m["id"] == 1);
        say(json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }));
        let uri = format!("{root}/longhand_import_check.py");
        let text = "import attrs\nimport not_installed_anywhere\nprint(attrs, not_installed_anywhere)\n";
        say(json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didOpen",
            "params": { "textDocument": { "uri": uri, "languageId": "python", "version": 1, "text": text } }
        }));
        let published = message_where(&events, |m| {
            m["method"] == "textDocument/publishDiagnostics"
                && m["params"]["uri"] == uri.as_str()
                && m["params"]["diagnostics"].as_array().is_some_and(|d| !d.is_empty())
        });
        let messages: Vec<&str> =
            published["params"]["diagnostics"].as_array().unwrap().iter().filter_map(|d| d["message"].as_str()).collect();
        assert!(messages.iter().any(|m| m.contains("not_installed_anywhere")), "{messages:?}");
        assert!(!messages.iter().any(|m| m.contains("attrs")), "{messages:?}");
        stop(&state, id);
    }
}
