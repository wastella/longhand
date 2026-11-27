//! File access for the interface: listing, reading, writing, creating, renaming, trashing,
//! quick open, find in files and watching for changes, always inside the open folder.

mod index;
mod memory;
mod search;
mod walk;
mod watch;

use crate::workspace::{err, workspace, AppState, R};
use index::FileIndex;
use notify::RecommendedWatcher;
use serde_json::{json, Value};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

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

fn mtime_ms(p: &Path) -> f64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// The entries of a folder for the tree: [{ path, name, dir, ignored }].
#[tauri::command]
pub async fn fs_list(app: AppHandle, rel: String) -> R<Vec<Value>> {
    off_main(move || {
        let state = app.state::<AppState>();
        let entries = walk::list_dir(&workspace(&state)?, &in_workspace(&state, &rel)?).map_err(err)?;
        let prefix = if rel.is_empty() || rel == "." { String::new() } else { format!("{}/", rel.trim_end_matches('/')) };
        Ok(entries
            .into_iter()
            .map(|e| json!({ "path": format!("{prefix}{}", e.name), "name": e.name, "dir": e.dir, "ignored": e.ignored }))
            .collect())
    })
    .await?
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
        return Err("Something with that name already exists".into());
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
    rename(&state, &from, &to)
}

fn rename(state: &AppState, from: &str, to: &str) -> R<()> {
    let src = in_workspace(state, from)?;
    let dst = in_workspace(state, to)?;
    if fs::symlink_metadata(&dst).is_ok() && !only_case_differs(&src, &dst) {
        return Err("Something with that name already exists".into());
    }
    if dst.starts_with(&src) && dst != src {
        return Err("A folder cannot be moved inside itself".into());
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::rename(src, dst).map_err(err)
}

/// Whether `a` and `b` are one entry whose name differs only in case, as `model.py` and
/// `Model.py` are on a case-insensitive disk. Links are not followed: renaming a link onto its
/// target must be refused, not replace the target.
fn only_case_differs(a: &Path, b: &Path) -> bool {
    if a.to_string_lossy().to_lowercase() != b.to_string_lossy().to_lowercase() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (fs::symlink_metadata(a), fs::symlink_metadata(b)) {
            (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    true
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

// ---- quick open, find in files, watching, revealing and the tree's memory ----

/// The backend state behind quick open, find in files and watching the folder.
#[derive(Default)]
pub struct FilesState {
    index: FileIndex,
    /// Bumped by every search, so a running search can see that a newer one replaced it.
    searches: AtomicU64,
    watcher: Mutex<Option<RecommendedWatcher>>,
    /// Held while the tree's memory file is read or rewritten.
    memory: Mutex<()>,
}

/// Whether `root` is still the open folder.
fn is_open(app: &AppHandle, root: &Path) -> bool {
    workspace(&app.state::<AppState>()).is_ok_and(|ws| ws == root)
}

/// Runs slow file work on a blocking thread, off the main thread and the async workers.
async fn off_main<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(err)
}

/// Every file quick open offers: { files: [path], truncated }.
#[tauri::command]
pub async fn fs_files(app: AppHandle) -> R<Value> {
    let ws = workspace(&app.state::<AppState>())?;
    off_main(move || match app.state::<FilesState>().index.listing(&ws, || is_open(&app, &ws)) {
        Some(listing) => json!({ "files": listing.files, "truncated": listing.truncated }),
        None => json!({ "cancelled": true }),
    })
    .await
}

/// Plain-text search: { hits: [{ path, line, text, ranges }], files, truncated, skipped }, or
/// { cancelled: true } when a newer search started before this one finished.
#[tauri::command]
pub async fn fs_search(app: AppHandle, query: String, case_sensitive: Option<bool>, whole_word: Option<bool>) -> R<Value> {
    let ws = workspace(&app.state::<AppState>())?;
    let generation = app.state::<FilesState>().searches.fetch_add(1, Ordering::SeqCst) + 1;
    if query.is_empty() {
        return Ok(json!(search::Found::default()));
    }
    let matcher = search::Matcher::new(&query, case_sensitive.unwrap_or(false), whole_word.unwrap_or(false));
    off_main(move || {
        let files = app.state::<FilesState>();
        let replaced = || files.searches.load(Ordering::SeqCst) != generation || !is_open(&app, &ws);
        let Some(listing) = files.index.listing(&ws, || !replaced()) else { return json!({ "cancelled": true }) };
        match search::search(&ws, &listing.files, &matcher, replaced) {
            Some(found) => json!(found),
            None => json!({ "cancelled": true }),
        }
    })
    .await
}

/// Starts watching the open folder, replacing any earlier watch. Changes arrive as
/// `files:changed` events, { root, paths }, with paths relative to root or `[""]` when anything
/// may have changed. Batches stop as soon as root is no longer the open folder.
#[tauri::command]
pub async fn fs_watch(app: AppHandle) -> R<()> {
    off_main(move || {
        let ws = workspace(&app.state::<AppState>())?;
        let files = app.state::<FilesState>();
        let mut current = files.watcher.lock().unwrap();
        *current = None;
        files.index.invalidate();
        let (check, emitter, root, watched) = (app.clone(), app.clone(), ws.clone(), ws.clone());
        let watcher = watch::watch(
            ws.clone(),
            move || is_open(&check, &watched),
            move |paths| {
                emitter.state::<FilesState>().index.invalidate();
                let _ = emitter.emit("files:changed", json!({ "root": root, "paths": paths }));
            },
        )
        .map_err(|e| {
            format!("Cannot watch this folder for changes ({e}). Changes made outside Longhand appear when you switch back to it.")
        })?;
        *current = Some(watcher);
        drop(current);
        // List the files now, so the first quick open is instant.
        let warm = app.clone();
        std::thread::spawn(move || warm.state::<FilesState>().index.listing(&ws, || is_open(&warm, &ws)));
        Ok(())
    })
    .await?
}

/// Shows a file or folder in Finder (or the system file manager).
#[tauri::command]
pub fn fs_reveal(state: State<AppState>, rel: String) -> R<()> {
    let path = in_workspace(&state, &rel)?;
    let mut command;
    if cfg!(target_os = "macos") {
        command = Command::new("open");
        command.arg("-R").arg(&path);
    } else {
        command = Command::new("xdg-open");
        command.arg(path.parent().unwrap_or(&path));
    }
    command.spawn().map(|_| ()).map_err(err)
}

fn memory_store(app: &AppHandle) -> R<PathBuf> {
    app.path().app_data_dir().map(|d| d.join("tree-memory.json")).map_err(err)
}

/// What the file tree remembered about the open folder, or null.
#[tauri::command]
pub async fn files_memory_load(app: AppHandle) -> R<Value> {
    off_main(move || {
        let folder = workspace(&app.state::<AppState>())?;
        let files = app.state::<FilesState>();
        let _held = files.memory.lock().unwrap();
        Ok(memory::load(&memory_store(&app)?, &folder.to_string_lossy()))
    })
    .await?
}

/// Remembers `memory` for `folder`. The interface names the folder, so a save scheduled just
/// before another folder opens still lands on the folder it belongs to.
#[tauri::command]
pub async fn files_memory_save(app: AppHandle, folder: String, memory: Value) -> R<()> {
    off_main(move || {
        let files = app.state::<FilesState>();
        let _held = files.memory.lock().unwrap();
        memory::save(&memory_store(&app)?, &folder, memory, chrono::Utc::now().timestamp_millis())
    })
    .await?
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
    fn renames_refuse_clashes_but_allow_changing_case() {
        let ws = temp_dir("rename");
        fs::write(ws.join("model.py"), "").unwrap();
        fs::write(ws.join("other.py"), "").unwrap();
        fs::create_dir_all(ws.join("pkg")).unwrap();
        let state = state_for(&ws);

        assert!(rename(&state, "model.py", "other.py").is_err());
        assert_eq!(rename(&state, "pkg", "pkg/inner"), Err("A folder cannot be moved inside itself".into()));
        rename(&state, "model.py", "Model.py").unwrap();
        assert!(fs::read_dir(&ws).unwrap().flatten().any(|e| e.file_name() == "Model.py"));
        rename(&state, "Model.py", "pkg/sub/model.py").unwrap();
        assert!(ws.join("pkg/sub/model.py").is_file());
        fs::remove_dir_all(ws).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn renaming_a_link_onto_its_target_keeps_the_target() {
        let ws = temp_dir("rename-link");
        fs::write(ws.join("target.py"), "the student's work").unwrap();
        std::os::unix::fs::symlink(ws.join("target.py"), ws.join("link.py")).unwrap();
        let state = state_for(&ws);

        assert!(rename(&state, "link.py", "target.py").is_err());
        assert!(rename(&state, "target.py", "link.py").is_err());
        assert_eq!(fs::read_to_string(ws.join("target.py")).unwrap(), "the student's work");
        assert!(fs::symlink_metadata(ws.join("target.py")).unwrap().is_file());
        fs::remove_dir_all(ws).unwrap();
    }

    #[test]
    fn no_folder_open_is_an_error() {
        assert!(in_workspace(&AppState::default(), "a.py").is_err());
    }
}
