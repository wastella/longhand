//! The open folder: which one it is, its per-folder settings and usage log in `.longhand/`,
//! and the app-wide record of the last folder opened.

use crate::{pytest, term, tutor};
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
}

pub type R<T> = Result<T, String>;
pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub fn workspace(state: &AppState) -> R<PathBuf> {
    state.workspace.lock().unwrap().clone().ok_or_else(|| "No folder is open".to_string())
}

// ---- per-user state ----

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

// ---- opening a folder ----

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
    pytest::cancel(&state);
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

pub fn choose_folder(app: &AppHandle) {
    let handle = app.clone();
    app.dialog().file().pick_folder(move |picked| {
        if let Some(Ok(path)) = picked.map(|p| p.into_path()) {
            let _ = open_workspace(&handle, path);
        }
    });
}

// ---- commands ----

#[tauri::command]
pub async fn app_init(app: AppHandle) -> Value {
    let last = load_app_state(&app)["workspace"].as_str().filter(|p| Path::new(p).is_dir()).map(String::from);
    json!({
        "lastWorkspace": last,
        "auth": tutor::read_auth(),
        "smoke": std::env::var("LONGHAND_SMOKE").is_ok(),
        "smokeDir": std::env::var("LONGHAND_SMOKE_DIR").ok(),
        // `longhand path/to/folder` opens that folder straight away.
        "openDir": std::env::args().nth(1).filter(|a| Path::new(a).is_dir()),
    })
}

#[tauri::command]
pub fn workspace_choose(app: AppHandle) {
    choose_folder(&app);
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
