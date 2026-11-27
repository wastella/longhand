//! File access for the interface: listing, reading, writing, creating, renaming, trashing and
//! searching, always inside the open folder.

use crate::workspace::{err, workspace, AppState, R};
use serde_json::{json, Value};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::State;

const IGNORED: &[&str] = &[
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    "node_modules",
    ".pytest_cache",
    ".ruff_cache",
    ".mypy_cache",
    ".longhand",
    ".DS_Store",
    "wandb",
    ".ipynb_checkpoints",
    "target",
];
const MAX_FILE_BYTES: u64 = 3 * 1024 * 1024;

/// Every path from the interface must stay inside the open folder.
fn in_workspace(state: &AppState, rel: &str) -> R<PathBuf> {
    let ws = workspace(state)?;
    let mut out = ws.clone();
    for c in Path::new(rel).components() {
        match c {
            Component::Normal(p) => out.push(p),
            Component::CurDir => {}
            _ => return Err("Path is outside the workspace".into()),
        }
    }
    // Resolve symlinks on the nearest existing ancestor so a link cannot lead outside.
    let mut probe = out.clone();
    while !probe.exists() {
        if !probe.pop() {
            break;
        }
    }
    let real = probe.canonicalize().map_err(err)?;
    if !real.starts_with(ws.canonicalize().map_err(err)?) {
        return Err("Path is outside the workspace".into());
    }
    Ok(out)
}

fn is_ignored(name: &str) -> bool {
    IGNORED.contains(&name) || name.ends_with(".pyc")
}

fn mtime_ms(p: &Path) -> f64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

#[tauri::command]
pub fn fs_list(state: State<AppState>, rel: String) -> R<Vec<Value>> {
    let dir = in_workspace(&state, &rel)?;
    let mut entries: Vec<(bool, String)> = fs::read_dir(&dir)
        .map_err(err)?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if is_ignored(&name) {
                return None;
            }
            Some((e.path().is_dir(), name))
        })
        .collect();
    entries.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.to_lowercase().cmp(&b.1.to_lowercase())));
    let prefix = if rel.is_empty() || rel == "." { String::new() } else { format!("{}/", rel.trim_end_matches('/')) };
    Ok(entries.into_iter().map(|(is_dir, name)| json!({ "path": format!("{prefix}{name}"), "name": name, "dir": is_dir })).collect())
}

#[tauri::command]
pub fn fs_read(state: State<AppState>, rel: String) -> R<Value> {
    let p = in_workspace(&state, &rel)?;
    let size = fs::metadata(&p).map_err(err)?.len();
    if size > MAX_FILE_BYTES {
        return Ok(json!({ "tooLarge": true, "size": size }));
    }
    let bytes = fs::read(&p).map_err(err)?;
    if bytes.iter().take(8000).any(|b| *b == 0) {
        return Ok(json!({ "binary": true, "size": size }));
    }
    Ok(json!({ "text": String::from_utf8_lossy(&bytes), "mtime": mtime_ms(&p) }))
}

#[tauri::command]
pub fn fs_write(state: State<AppState>, rel: String, text: String) -> R<Value> {
    let p = in_workspace(&state, &rel)?;
    fs::write(&p, text).map_err(err)?;
    Ok(json!({ "mtime": mtime_ms(&p) }))
}

#[tauri::command]
pub fn fs_mtime(state: State<AppState>, rel: String) -> R<f64> {
    Ok(mtime_ms(&in_workspace(&state, &rel)?))
}

#[tauri::command]
pub fn fs_create(state: State<AppState>, rel: String, dir: bool) -> R<()> {
    let p = in_workspace(&state, &rel)?;
    if p.exists() {
        return Err("Already exists".into());
    }
    if dir {
        fs::create_dir_all(&p).map_err(err)
    } else {
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).map_err(err)?;
        }
        fs::OpenOptions::new().write(true).create_new(true).open(&p).map(|_| ()).map_err(err)
    }
}

#[tauri::command]
pub fn fs_rename(state: State<AppState>, from: String, to: String) -> R<()> {
    let src = in_workspace(&state, &from)?;
    let dst = in_workspace(&state, &to)?;
    if dst.exists() {
        return Err("Something with that name already exists".into());
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::rename(src, dst).map_err(err)
}

/// Deleting from the file tree moves the item to the system Trash, so it can be recovered.
#[tauri::command]
pub fn fs_trash(state: State<AppState>, rel: String) -> R<()> {
    let p = in_workspace(&state, &rel)?;
    if p == workspace(&state)? {
        return Err("The open folder itself cannot be deleted from here".into());
    }
    trash::delete(p).map_err(err)
}

/// Case-insensitive text search across the folder's source files.
#[tauri::command]
pub async fn fs_search(state: State<'_, AppState>, query: String) -> R<Value> {
    const MAX_HITS: usize = 300;
    const MAX_SEARCH_BYTES: u64 = 1024 * 1024;
    let ws = workspace(&state)?;
    let needle = query.to_lowercase();
    let mut hits = Vec::new();
    let mut truncated = false;
    if needle.trim().is_empty() {
        return Ok(json!({ "hits": hits, "truncated": false }));
    }
    let mut stack = vec![ws.clone()];
    'walk: while let Some(dir) = stack.pop() {
        let Ok(read) = fs::read_dir(&dir) else { continue };
        let mut entries: Vec<_> = read.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().to_string();
            if is_ignored(&name) {
                continue;
            }
            let Ok(kind) = e.file_type() else { continue };
            if kind.is_dir() {
                stack.push(e.path());
                continue;
            }
            if !kind.is_file() || e.metadata().map(|m| m.len() > MAX_SEARCH_BYTES).unwrap_or(true) {
                continue;
            }
            let Ok(text) = fs::read_to_string(e.path()) else { continue };
            let rel = e.path().strip_prefix(&ws).unwrap_or(&e.path()).to_string_lossy().to_string();
            for (i, line) in text.lines().enumerate() {
                if line.to_lowercase().contains(&needle) {
                    if hits.len() >= MAX_HITS {
                        truncated = true;
                        break 'walk;
                    }
                    let shown: String = line.trim().chars().take(200).collect();
                    hits.push(json!({ "path": rel, "line": i + 1, "text": shown }));
                }
            }
        }
    }
    Ok(json!({ "hits": hits, "truncated": truncated }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::tests::temp_dir;

    fn state_for(dir: &Path) -> AppState {
        let state = AppState::default();
        *state.workspace.lock().unwrap() = Some(dir.canonicalize().unwrap());
        state
    }

    #[test]
    fn paths_stay_inside_the_workspace() {
        let root = temp_dir("paths");
        let ws = root.join("ws");
        fs::create_dir_all(ws.join("pkg")).unwrap();
        fs::write(root.join("secret.txt"), "x").unwrap();
        let state = state_for(&ws);

        assert!(in_workspace(&state, "pkg/new_file.py").is_ok());
        assert!(in_workspace(&state, "./pkg").is_ok());
        assert!(in_workspace(&state, "").is_ok());
        assert!(in_workspace(&state, "../secret.txt").is_err());
        assert!(in_workspace(&state, "pkg/../../secret.txt").is_err());
        assert!(in_workspace(&state, "/etc/passwd").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_lead_outside() {
        let root = temp_dir("links");
        let ws = root.join("ws");
        fs::create_dir_all(&ws).unwrap();
        fs::create_dir_all(root.join("outside")).unwrap();
        std::os::unix::fs::symlink(root.join("outside"), ws.join("link")).unwrap();
        let state = state_for(&ws);

        assert!(in_workspace(&state, "link/file.txt").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn no_folder_open_is_an_error() {
        assert!(in_workspace(&AppState::default(), "a.py").is_err());
    }
}
