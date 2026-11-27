//! The integrated terminal: a login shell on a pseudo-terminal, started in the open folder.

use crate::workspace::AppState;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde_json::json;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, State};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

pub struct Term {
    id: u64,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

pub fn kill(state: &AppState) {
    if let Some(mut t) = state.term.lock().unwrap().take() {
        let _ = t.child.kill();
    }
}

#[tauri::command]
pub fn term_start(app: AppHandle, state: State<AppState>, cols: u16, rows: u16) -> Result<u64, String> {
    kill(&state);
    let cwd = state.workspace.lock().unwrap().clone().or_else(|| std::env::var_os("HOME").map(Into::into));
    let pair = native_pty_system()
        .openpty(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut cmd = CommandBuilder::new(shell);
    cmd.arg("-l");
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }
    cmd.env("TERM", "xterm-256color");
    if std::env::var_os("LANG").is_none() {
        cmd.env("LANG", "en_US.UTF-8");
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);

    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    // Emit only complete UTF-8; keep a split character for the next read.
                    let cut = match std::str::from_utf8(&pending) {
                        Ok(_) => pending.len(),
                        Err(e) if e.error_len().is_none() => e.valid_up_to(),
                        Err(_) => pending.len(),
                    };
                    if cut > 0 {
                        let text = String::from_utf8_lossy(&pending[..cut]).to_string();
                        pending.drain(..cut);
                        let _ = app.emit("term:data", json!({ "id": id, "data": text }));
                    }
                }
            }
        }
        let _ = app.emit("term:exit", json!({ "id": id }));
    });

    *state.term.lock().unwrap() = Some(Term { id, master: pair.master, writer, child });
    Ok(id)
}

#[tauri::command]
pub fn term_input(state: State<AppState>, id: u64, data: String) {
    if let Some(t) = state.term.lock().unwrap().as_mut() {
        if t.id == id {
            let _ = t.writer.write_all(data.as_bytes());
            let _ = t.writer.flush();
        }
    }
}

#[tauri::command]
pub fn term_resize(state: State<AppState>, id: u64, cols: u16, rows: u16) {
    if let Some(t) = state.term.lock().unwrap().as_ref() {
        if t.id == id && cols > 0 && rows > 0 {
            let _ = t.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 });
        }
    }
}
