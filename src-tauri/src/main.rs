#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod pytest;
mod term;
mod tutor;

use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

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

#[derive(Default)]
pub struct AppState {
    pub workspace: Mutex<Option<PathBuf>>,
    pub term: Mutex<Option<term::Term>>,
    pub tests: Mutex<pytest::TestRun>,
    pub tutor: Mutex<tutor::TutorState>,
}

type R<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub fn workspace(state: &AppState) -> R<PathBuf> {
    state.workspace.lock().unwrap().clone().ok_or_else(|| "No folder is open".to_string())
}

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

// ---- per-user and per-workspace state ----

fn app_state_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("state.json"))
}
fn load_app_state(app: &AppHandle) -> Value {
    app_state_path(app).and_then(|p| fs::read_to_string(p).ok()).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_else(|| json!({}))
}
fn save_last_workspace(app: &AppHandle, ws: &Path) {
    if let Some(p) = app_state_path(app) {
        let _ = fs::create_dir_all(p.parent().unwrap());
        let _ = fs::write(p, json!({ "workspace": ws }).to_string());
    }
}

pub fn read_config(ws: &Path) -> Value {
    let default_policy = if tutor::read_course_rules(ws).is_some() { "strict" } else { "guided" };
    let mut cfg = json!({ "policy": default_policy, "model": "sonnet" });
    if let Some(Value::Object(saved)) =
        fs::read_to_string(ws.join(".longhand/config.json")).ok().and_then(|s| serde_json::from_str(&s).ok())
    {
        for (k, v) in saved {
            cfg[k] = v;
        }
    }
    cfg
}

pub fn log_event(ws: &Path, kind: &str, detail: Value) {
    let dir = ws.join(".longhand");
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let mut entry = json!({ "t": chrono::Local::now().to_rfc3339(), "kind": kind });
    if let Value::Object(d) = detail {
        for (k, v) in d {
            entry[k] = v;
        }
    }
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(dir.join("log.jsonl")) {
        let _ = writeln!(f, "{}", entry);
    }
}

fn log_summary_for(ws: &Path) -> Value {
    let kinds = ["ask", "reveal", "tests"];
    let mut today = [0u32; 3];
    let mut total = [0u32; 3];
    let now = chrono::Local::now().date_naive();
    if let Ok(text) = fs::read_to_string(ws.join(".longhand/log.jsonl")) {
        for line in text.lines() {
            let Ok(e) = serde_json::from_str::<Value>(line) else { continue };
            let Some(i) = kinds.iter().position(|k| e["kind"] == *k) else { continue };
            total[i] += 1;
            let is_today = e["t"]
                .as_str()
                .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
                .map(|t| t.with_timezone(&chrono::Local).date_naive() == now)
                .unwrap_or(false);
            if is_today {
                today[i] += 1;
            }
        }
    }
    json!({
        "today": { "ask": today[0], "reveal": today[1], "tests": today[2] },
        "total": { "ask": total[0], "reveal": total[1], "tests": total[2] },
    })
}

fn open_workspace(app: &AppHandle, dir: PathBuf) -> R<()> {
    let ws = dir.canonicalize().map_err(err)?;
    if !ws.is_dir() {
        return Err("Not a folder".into());
    }
    let state = app.state::<AppState>();
    *state.workspace.lock().unwrap() = Some(ws.clone());
    save_last_workspace(app, &ws);
    tutor::reset(&state);
    term::kill(&state);
    let _ = app.emit(
        "workspace:opened",
        json!({
            "path": ws,
            "name": ws.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            "config": read_config(&ws),
            "courseRules": tutor::read_course_rules(&ws).map(|r| r.0),
            "log": log_summary_for(&ws),
        }),
    );
    Ok(())
}

fn choose_folder(app: &AppHandle) {
    let handle = app.clone();
    app.dialog().file().pick_folder(move |picked| {
        if let Some(Ok(path)) = picked.map(|p| p.into_path()) {
            let _ = open_workspace(&handle, path);
        }
    });
}

// ---- commands ----

#[tauri::command]
async fn app_init(app: AppHandle) -> Value {
    let last = load_app_state(&app)["workspace"].as_str().filter(|p| Path::new(p).is_dir()).map(String::from);
    json!({
        "lastWorkspace": last,
        "auth": tutor::auth_status(),
        "smoke": std::env::var("LONGHAND_SMOKE").is_ok(),
        "smokeDir": std::env::var("LONGHAND_SMOKE_DIR").ok(),
        // `longhand path/to/folder` opens that folder straight away.
        "openDir": std::env::args().nth(1).filter(|a| Path::new(a).is_dir()),
    })
}

#[tauri::command]
async fn auth_status() -> Value {
    tutor::auth_status()
}

#[tauri::command]
fn workspace_choose(app: AppHandle) {
    choose_folder(&app);
}

#[tauri::command]
fn workspace_open(app: AppHandle, dir: String) -> R<()> {
    open_workspace(&app, PathBuf::from(dir))
}

#[tauri::command]
fn fs_list(state: State<AppState>, rel: String) -> R<Vec<Value>> {
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

fn mtime_ms(p: &Path) -> f64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

#[tauri::command]
fn fs_read(state: State<AppState>, rel: String) -> R<Value> {
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
fn fs_write(state: State<AppState>, rel: String, text: String) -> R<Value> {
    let p = in_workspace(&state, &rel)?;
    fs::write(&p, text).map_err(err)?;
    Ok(json!({ "mtime": mtime_ms(&p) }))
}

#[tauri::command]
fn fs_mtime(state: State<AppState>, rel: String) -> R<f64> {
    Ok(mtime_ms(&in_workspace(&state, &rel)?))
}

#[tauri::command]
fn fs_create(state: State<AppState>, rel: String, dir: bool) -> R<()> {
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
fn fs_rename(state: State<AppState>, from: String, to: String) -> R<()> {
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
fn fs_trash(state: State<AppState>, rel: String) -> R<()> {
    let p = in_workspace(&state, &rel)?;
    if p == workspace(&state)? {
        return Err("The open folder itself cannot be deleted from here".into());
    }
    trash::delete(p).map_err(err)
}

fn is_ignored(name: &str) -> bool {
    IGNORED.contains(&name) || name.ends_with(".pyc")
}

/// Case-insensitive text search across the folder's source files.
#[tauri::command]
async fn fs_search(state: State<'_, AppState>, query: String) -> R<Value> {
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

#[tauri::command]
async fn confirm(app: AppHandle, message: String, action: String) -> bool {
    app.dialog().message(message).title("Longhand").buttons(MessageDialogButtons::OkCancelCustom(action, "Cancel".into())).blocking_show()
}

#[tauri::command]
fn open_external(url: String) -> R<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only web links can be opened".into());
    }
    let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    std::process::Command::new(opener).arg(url).spawn().map(|_| ()).map_err(err)
}

#[tauri::command]
fn config_set(state: State<AppState>, patch: Value) -> R<Value> {
    let ws = workspace(&state)?;
    let mut cfg = read_config(&ws);
    if let Value::Object(p) = &patch {
        for (k, v) in p {
            cfg[k] = v.clone();
        }
    }
    fs::create_dir_all(ws.join(".longhand")).map_err(err)?;
    fs::write(ws.join(".longhand/config.json"), serde_json::to_string_pretty(&cfg).map_err(err)?).map_err(err)?;
    log_event(&ws, "config", patch);
    Ok(cfg)
}

#[tauri::command]
fn log_record(state: State<AppState>, kind: String, detail: Value) -> R<Value> {
    let ws = workspace(&state)?;
    log_event(&ws, &kind, detail);
    Ok(log_summary_for(&ws))
}

#[tauri::command]
fn log_summary(state: State<AppState>) -> R<Value> {
    Ok(log_summary_for(&workspace(&state)?))
}

#[tauri::command]
fn smoke_result(app: AppHandle, result: Value) {
    println!("SMOKE {result}");
    if let Ok(path) = std::env::var("LONGHAND_SMOKE_OUT") {
        let _ = fs::write(path, result.to_string());
    }
    app.exit(if result["ok"] == true { 0 } else { 1 });
}

fn build_menu(app: &tauri::App) -> tauri::Result<()> {
    let item = |id: &str, label: &str, key: &str| MenuItemBuilder::with_id(id, label).accelerator(key).build(app);
    let app_menu =
        SubmenuBuilder::new(app, "Longhand").about(None).separator().hide().hide_others().show_all().separator().quit().build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&item("open-folder", "Open Folder…", "CmdOrCtrl+O")?)
        .item(&item("new-file", "New File…", "CmdOrCtrl+N")?)
        .separator()
        .item(&item("save", "Save", "CmdOrCtrl+S")?)
        .item(&item("close-tab", "Close Tab", "CmdOrCtrl+W")?)
        .separator()
        .item(&item("find-in-files", "Find in Files…", "CmdOrCtrl+Shift+F")?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit").undo().redo().separator().cut().copy().paste().select_all().build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&item("toggle-files", "Toggle Files", "CmdOrCtrl+B")?)
        .item(&item("toggle-bottom", "Toggle Terminal", "CmdOrCtrl+J")?)
        .item(&item("toggle-tutor", "Toggle Tutor", "CmdOrCtrl+L")?)
        .separator()
        .item(&item("zoom-in", "Bigger Text", "CmdOrCtrl+=")?)
        .item(&item("zoom-out", "Smaller Text", "CmdOrCtrl+-")?)
        .item(&item("zoom-reset", "Default Text Size", "CmdOrCtrl+0")?)
        .separator()
        .fullscreen()
        .build()?;
    let run = SubmenuBuilder::new(app, "Run")
        .item(&item("run-tests-file", "Run Tests in Current File", "CmdOrCtrl+T")?)
        .item(&item("run-tests", "Run All Tests", "CmdOrCtrl+Shift+T")?)
        .build()?;
    let tutor = SubmenuBuilder::new(app, "Tutor")
        .item(&item("ask-selection", "Explain Selection", "CmdOrCtrl+E")?)
        .item(&item("review-file", "Review Current File", "CmdOrCtrl+Shift+R")?)
        .item(&item("new-conversation", "New Conversation", "CmdOrCtrl+Shift+N")?)
        .build()?;
    let window = SubmenuBuilder::new(app, "Window").minimize().maximize().build()?;
    let menu = MenuBuilder::new(app).items(&[&app_menu, &file, &edit, &view, &run, &tutor, &window]).build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().0.as_str();
        if id == "open-folder" {
            choose_folder(app);
        } else {
            let _ = app.emit("menu", id);
        }
    });
    Ok(())
}

/// Claude Code finds its login through the user's name, which a bare launch environment may lack.
fn ensure_user_env() {
    if std::env::var_os("USER").is_some() {
        return;
    }
    let name = unsafe {
        let pw = libc::getpwuid(libc::getuid());
        if pw.is_null() {
            return;
        }
        std::ffi::CStr::from_ptr((*pw).pw_name).to_string_lossy().to_string()
    };
    std::env::set_var("USER", name);
}

fn main() {
    ensure_user_env();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            build_menu(app)?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Longhand")
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 560.0)
                .title_bar_style(TitleBarStyle::Overlay)
                .hidden_title(true)
                // The window only ever shows the app itself; links open in the browser.
                .on_navigation(|url| matches!(url.scheme(), "tauri" | "about"))
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<AppState>();
                term::kill(&state);
                tutor::cancel(&state);
                pytest::cancel(&state);
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_init,
            auth_status,
            workspace_choose,
            workspace_open,
            fs_list,
            fs_read,
            fs_write,
            fs_mtime,
            fs_create,
            fs_rename,
            fs_trash,
            fs_search,
            confirm,
            open_external,
            config_set,
            log_record,
            log_summary,
            smoke_result,
            term::term_start,
            term::term_input,
            term::term_resize,
            pytest::tests_run,
            pytest::tests_cancel,
            tutor::tutor_ask,
            tutor::tutor_cancel,
            tutor::tutor_reset,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Longhand");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state_for(dir: &Path) -> AppState {
        let state = AppState::default();
        *state.workspace.lock().unwrap() = Some(dir.canonicalize().unwrap());
        state
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("longhand-test-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
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

    #[test]
    fn course_rules_make_strict_the_default_policy() {
        let ws = temp_dir("policy");
        assert_eq!(read_config(&ws)["policy"], "guided");
        fs::write(ws.join("AGENTS.md"), "Act as a teaching assistant.").unwrap();
        assert_eq!(read_config(&ws)["policy"], "strict");
        // A saved choice wins over the default.
        fs::create_dir_all(ws.join(".longhand")).unwrap();
        fs::write(ws.join(".longhand/config.json"), r#"{"policy":"guided"}"#).unwrap();
        assert_eq!(read_config(&ws)["policy"], "guided");
        assert_eq!(read_config(&ws)["model"], "sonnet");
        fs::remove_dir_all(ws).unwrap();
    }

    #[test]
    fn log_counts_questions_reveals_and_test_runs() {
        let ws = temp_dir("log");
        log_event(&ws, "ask", json!({ "about": "question" }));
        log_event(&ws, "ask", json!({ "about": "review" }));
        log_event(&ws, "reveal", json!({ "lines": 4 }));
        log_event(&ws, "config", json!({ "policy": "guided" }));
        let summary = log_summary_for(&ws);
        assert_eq!(summary["today"], json!({ "ask": 2, "reveal": 1, "tests": 0 }));
        assert_eq!(summary["total"]["ask"], 2);
        fs::remove_dir_all(ws).unwrap();
    }
}
