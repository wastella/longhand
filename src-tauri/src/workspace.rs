//! The open folder: which one it is, and its per-folder settings and usage log in `.longhand/`.
//! App-wide preferences, including the recent folders, are in `prefs.rs`.

use crate::{lsp, notebook, prefs, pytest, term, tutor};
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct AppState {
    pub workspace: Mutex<Option<PathBuf>>,
    pub term: Mutex<Option<term::Term>>,
    pub tests: Mutex<pytest::TestRun>,
    pub tutor: Mutex<tutor::TutorState>,
    pub lsp: Mutex<lsp::Lsp>,
}

pub type R<T> = Result<T, String>;
pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub fn workspace(state: &AppState) -> R<PathBuf> {
    state.workspace.lock().unwrap().clone().ok_or_else(|| "No folder is open".to_string())
}

// ---- per-folder settings and log ----

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

/// The folder's `.longhand/`, created if needed. It holds tutor transcripts and the usage log, so
/// it carries its own `.gitignore` and `git add .` never picks any of it up.
pub fn longhand_dir(ws: &Path) -> std::io::Result<PathBuf> {
    let dir = ws.join(".longhand");
    fs::create_dir_all(&dir)?;
    let ignore = dir.join(".gitignore");
    if !ignore.exists() {
        fs::write(ignore, "*\n")?;
    }
    Ok(dir)
}

pub fn log_event(ws: &Path, kind: &str, detail: Value) {
    let Ok(dir) = longhand_dir(ws) else { return };
    let mut entry = json!({ "t": chrono::Local::now().to_rfc3339(), "kind": kind });
    if let Value::Object(d) = detail {
        // The detail never replaces the entry's time or kind: every reader counts by `kind`.
        for (k, v) in d.into_iter().filter(|(k, _)| k != "t" && k != "kind") {
            entry[k] = v;
        }
    }
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(dir.join("log.jsonl")) {
        let _ = writeln!(f, "{}", entry);
    }
}

/// The title bar's counts, from the same reader as the tutor's Record view (`tutor/record.rs`).
fn log_summary_for(ws: &Path) -> Value {
    tutor::log_summary(ws)
}

// ---- opening a folder ----

/// Why `dir` cannot be opened as a folder, in words a student can act on.
fn check_folder(dir: &Path) -> R<()> {
    if !dir.exists() {
        return Err(format!("{} no longer exists. It may have been moved or deleted.", dir.display()));
    }
    if !dir.is_dir() {
        return Err(format!("{} is a file. Open the folder that contains it instead.", dir.display()));
    }
    Ok(())
}

fn open_workspace(app: &AppHandle, dir: PathBuf) -> R<()> {
    check_folder(&dir)?;
    let ws = dir.canonicalize().map_err(err)?;
    let state = app.state::<AppState>();
    *state.workspace.lock().unwrap() = Some(ws.clone());
    prefs::remember_folder(app, &ws);
    tutor::reset(&state);
    term::kill(&state);
    pytest::cancel(&state);
    lsp::folder_opened(app, &state, &ws);
    notebook::stop_all(app);
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

// ---- commands ----

#[tauri::command]
pub async fn app_init(app: AppHandle) -> Value {
    let mut init = prefs::startup(&app);
    init["version"] = json!(app.package_info().version.to_string());
    init["auth"] = tutor::read_auth();
    init["smoke"] = json!(std::env::var("LONGHAND_SMOKE").is_ok());
    init["smokeDir"] = json!(std::env::var("LONGHAND_SMOKE_DIR").ok());
    // `longhand path/to/folder` opens that folder straight away.
    init["openDir"] = json!(std::env::args().nth(1).filter(|a| Path::new(a).is_dir()));
    init
}

/// Asks for a folder with the system picker. Returns its path, or null if the student cancelled;
/// the interface then opens it with workspace_open once nothing would be lost.
#[tauri::command]
pub async fn workspace_choose(app: AppHandle) -> Option<String> {
    let picked = app.dialog().file().set_title("Open Folder").blocking_pick_folder()?;
    picked.into_path().ok().map(|p| p.to_string_lossy().to_string())
}

/// Whether `dir` can be opened as a folder, checked before anyone is asked about unsaved work.
/// Async, so a slow volume does not block the window.
#[tauri::command]
pub async fn folder_check(dir: String) -> R<()> {
    check_folder(Path::new(&dir))
}

#[tauri::command]
pub fn workspace_open(app: AppHandle, dir: String) -> R<()> {
    open_workspace(&app, PathBuf::from(dir))
}

#[tauri::command]
pub fn config_set(state: State<AppState>, patch: Value) -> R<Value> {
    let ws = workspace(&state)?;
    let mut cfg = read_config(&ws);
    if let Value::Object(p) = &patch {
        for (k, v) in p {
            cfg[k] = v.clone();
        }
    }
    longhand_dir(&ws).map_err(err)?;
    fs::write(ws.join(".longhand/config.json"), serde_json::to_string_pretty(&cfg).map_err(err)?).map_err(err)?;
    log_event(&ws, "config", patch);
    Ok(cfg)
}

#[tauri::command]
pub fn log_record(state: State<AppState>, kind: String, detail: Value) -> R<Value> {
    let ws = workspace(&state)?;
    log_event(&ws, &kind, detail);
    Ok(log_summary_for(&ws))
}

#[tauri::command]
pub fn log_summary(state: State<AppState>) -> R<Value> {
    Ok(log_summary_for(&workspace(&state)?))
}

#[cfg(test)]
pub mod tests {
    use super::*;

    pub fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("longhand-test-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
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
    fn missing_folders_and_files_cannot_be_opened() {
        let ws = temp_dir("check");
        assert!(check_folder(&ws).is_ok());
        assert!(check_folder(&ws.join("gone")).unwrap_err().contains("no longer exists"));
        fs::write(ws.join("notes.txt"), "").unwrap();
        assert!(check_folder(&ws.join("notes.txt")).unwrap_err().contains("is a file"));
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
        // Transcripts and the log live here, so Git is told to leave all of it alone.
        assert_eq!(fs::read_to_string(ws.join(".longhand/.gitignore")).unwrap(), "*\n");
        fs::remove_dir_all(ws).unwrap();
    }
}
