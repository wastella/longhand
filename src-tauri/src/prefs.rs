//! App-wide preferences, kept in the app data directory rather than in any folder:
//! `settings.json` holds the student's settings (theme, text size, and whatever other areas
//! register), and `state.json` what the app remembers between launches (the last folder, recent
//! folders, the panel layout, and the folders the student has decided about code checking for).
//! Window size and position are kept by tauri-plugin-window-state.

use crate::workspace::{err, R};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const SETTINGS: &str = "settings.json";
const STATE: &str = "state.json";
const MAX_RECENTS: usize = 10;
const CODE_CHECKING: &str = "codeChecking";

/// Both files are read-modify-written from several commands, which may run at the same time.
static FILES: Mutex<()> = Mutex::new(());

fn data_dir(app: &AppHandle) -> R<PathBuf> {
    app.path().app_data_dir().map_err(err)
}

/// The JSON object in `dir/name`, or an empty one if the file is missing or unreadable.
fn read_object(dir: &Path, name: &str) -> Map<String, Value> {
    match fs::read_to_string(dir.join(name)).ok().and_then(|s| serde_json::from_str(&s).ok()) {
        Some(Value::Object(map)) => map,
        _ => Map::new(),
    }
}

/// Changes the object in `dir/name` with `change` and writes it back. The write goes through a
/// temporary file so a crash mid-write cannot leave a half-written file behind.
fn update_object<T>(dir: &Path, name: &str, change: impl FnOnce(&mut Map<String, Value>) -> T) -> R<T> {
    let _lock = FILES.lock().unwrap();
    let mut object = read_object(dir, name);
    let result = change(&mut object);
    fs::create_dir_all(dir).map_err(err)?;
    let temp = dir.join(format!("{name}.tmp"));
    fs::write(&temp, serde_json::to_string_pretty(&object).map_err(err)?).map_err(err)?;
    fs::rename(temp, dir.join(name)).map_err(err)?;
    Ok(result)
}

/// Copies each key of `patch` into `target`; a null value removes the key (back to its default).
fn merge(target: &mut Map<String, Value>, patch: &Value) {
    let Value::Object(patch) = patch else { return };
    for (key, value) in patch {
        if value.is_null() {
            target.remove(key);
        } else {
            target.insert(key.clone(), value.clone());
        }
    }
}

// ---- recent folders ----

/// The recent list with `path` moved to the front as opened at `now`, at most MAX_RECENTS long.
fn add_recent(recents: &Value, path: &str, now: &str) -> Value {
    let mut list: Vec<Value> = recents.as_array().cloned().unwrap_or_default();
    list.retain(|r| r["path"] != path);
    list.insert(0, json!({ "path": path, "openedAt": now }));
    list.truncate(MAX_RECENTS);
    Value::Array(list)
}

fn without_recent(recents: &Value, path: &str) -> Value {
    let list = recents.as_array().cloned().unwrap_or_default();
    Value::Array(list.into_iter().filter(|r| r["path"] != path).collect())
}

/// `path` with the home folder written as ~, the way Finder and the terminal show it.
fn short_path(path: &Path, home: Option<&Path>) -> String {
    match home.and_then(|home| path.strip_prefix(home).ok()) {
        Some(rest) if rest.as_os_str().is_empty() => "~".into(),
        Some(rest) => format!("~/{}", rest.display()),
        None => path.display().to_string(),
    }
}

/// The recent list as the interface shows it: each entry with its folder name and a short path.
/// With `check`, also whether it still exists, so a moved or deleted folder can be shown as
/// missing. Checking touches each folder, which can stall on an unplugged network volume, so
/// start-up leaves it out and the interface asks for the checked list afterwards.
fn describe_recents(recents: &Value, check: bool) -> Value {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let list = recents.as_array().cloned().unwrap_or_default();
    let described = list.into_iter().filter_map(|r| {
        let path = Path::new(r["path"].as_str()?);
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.display().to_string());
        let short = short_path(path, home.as_deref());
        let exists = if check { json!(path.is_dir()) } else { Value::Null };
        Some(json!({ "path": path, "shortPath": short, "name": name, "openedAt": r["openedAt"], "exists": exists }))
    });
    Value::Array(described.collect())
}

// ---- code checking, per folder ----

/// What the student decided about code checking (lsp.rs) for `folder`: on, off, or `None` when
/// they have not been asked. It is kept here, by the folder's path, and never inside the
/// folder: a folder must not be able to say of itself that it is trusted.
fn code_checking_in(dir: &Path, folder: &Path) -> Option<bool> {
    read_object(dir, STATE).get(CODE_CHECKING)?.get(folder.to_string_lossy().as_ref())?.as_bool()
}

fn set_code_checking_in(dir: &Path, folder: &Path, on: bool) -> R<()> {
    update_object(dir, STATE, |state| {
        let mut folders = state.get(CODE_CHECKING).and_then(Value::as_object).cloned().unwrap_or_default();
        folders.insert(folder.to_string_lossy().into_owned(), json!(on));
        state.insert(CODE_CHECKING.into(), Value::Object(folders));
    })
}

pub fn code_checking(app: &AppHandle, folder: &Path) -> Option<bool> {
    code_checking_in(&data_dir(app).ok()?, folder)
}

pub fn set_code_checking(app: &AppHandle, folder: &Path, on: bool) -> R<()> {
    set_code_checking_in(&data_dir(app)?, folder, on)
}

/// Records `folder` as the last one opened and the most recent.
pub fn remember_folder(app: &AppHandle, folder: &Path) {
    let Ok(dir) = data_dir(app) else { return };
    let path = folder.to_string_lossy().to_string();
    let now = chrono::Local::now().to_rfc3339();
    let _ = update_object(&dir, STATE, |state| {
        let recents = add_recent(state.get("recents").unwrap_or(&Value::Null), &path, &now);
        state.insert("recents".into(), recents);
        state.insert("workspace".into(), json!(path));
    });
}

/// What the interface needs at start-up: settings, layout, recent folders (unchecked) and the
/// last folder. Nothing here touches the folders themselves, so a missing volume cannot hold up
/// the launch; the interface checks the last folder before opening it.
pub fn startup(app: &AppHandle) -> Value {
    let Ok(dir) = data_dir(app) else { return json!({ "settings": {}, "layout": null, "recents": [], "lastWorkspace": null }) };
    let state = read_object(&dir, STATE);
    let last = state.get("workspace").and_then(Value::as_str);
    json!({
        "settings": read_object(&dir, SETTINGS),
        "layout": state.get("layout"),
        "recents": describe_recents(state.get("recents").unwrap_or(&Value::Null), false),
        "lastWorkspace": last,
    })
}

// ---- commands ----

/// Saves the settings in `patch` (null resets one to its default) and returns all of them.
#[tauri::command]
pub fn settings_set(app: AppHandle, patch: Value) -> R<Value> {
    update_object(&data_dir(&app)?, SETTINGS, |settings| {
        merge(settings, &patch);
        Value::Object(settings.clone())
    })
}

/// The recent folders, most recent first, each checked for whether it still exists. Async, so a
/// slow volume holds up only this answer.
#[tauri::command]
pub async fn recents_list(app: AppHandle) -> R<Value> {
    let state = read_object(&data_dir(&app)?, STATE);
    Ok(describe_recents(state.get("recents").unwrap_or(&Value::Null), true))
}

/// Removes a folder from the recent list and returns the list.
#[tauri::command]
pub async fn recent_forget(app: AppHandle, path: String) -> R<Value> {
    update_object(&data_dir(&app)?, STATE, |state| {
        let recents = without_recent(state.get("recents").unwrap_or(&Value::Null), &path);
        state.insert("recents".into(), recents.clone());
        describe_recents(&recents, true)
    })
}

/// Remembers the panel layout (which panels are open and their sizes) for the next launch.
#[tauri::command]
pub fn layout_save(app: AppHandle, layout: Value) -> R<()> {
    update_object(&data_dir(&app)?, STATE, |state| {
        state.insert("layout".into(), layout);
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::tests::temp_dir;

    #[test]
    fn recent_folders_move_to_the_front_without_duplicates() {
        let mut recents = Value::Null;
        for (i, path) in ["/a", "/b", "/a"].iter().enumerate() {
            recents = add_recent(&recents, path, &format!("t{i}"));
        }
        assert_eq!(recents, json!([{ "path": "/a", "openedAt": "t2" }, { "path": "/b", "openedAt": "t1" }]));
        assert_eq!(without_recent(&recents, "/a"), json!([{ "path": "/b", "openedAt": "t1" }]));
    }

    #[test]
    fn the_recent_list_is_capped() {
        let mut recents = Value::Null;
        for i in 0..(MAX_RECENTS + 3) {
            recents = add_recent(&recents, &format!("/f{i}"), "t");
        }
        let list = recents.as_array().unwrap();
        assert_eq!(list.len(), MAX_RECENTS);
        assert_eq!(list[0]["path"], format!("/f{}", MAX_RECENTS + 2));
    }

    #[test]
    fn recents_say_which_folders_still_exist() {
        let dir = temp_dir("recents");
        let gone = dir.join("gone");
        let recents = json!([{ "path": dir, "openedAt": "t" }, { "path": gone, "openedAt": "t" }, { "openedAt": "no path" }]);
        let described = describe_recents(&recents, true);
        assert_eq!(describe_recents(&recents, false)[1]["exists"], Value::Null, "unchecked at start-up");
        assert_eq!(described.as_array().unwrap().len(), 2);
        assert_eq!(described[0]["exists"], true);
        assert_eq!(described[0]["name"], dir.file_name().unwrap().to_string_lossy().to_string());
        assert_eq!(described[1]["exists"], false);
        assert_eq!(described[1]["name"], "gone");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn paths_under_home_are_shortened() {
        let home = Path::new("/Users/ada");
        assert_eq!(short_path(Path::new("/Users/ada/cs336/a1"), Some(home)), "~/cs336/a1");
        assert_eq!(short_path(home, Some(home)), "~");
        assert_eq!(short_path(Path::new("/Volumes/usb/a1"), Some(home)), "/Volumes/usb/a1");
        assert_eq!(short_path(Path::new("/Users/adam/x"), Some(home)), "/Users/adam/x");
        assert_eq!(short_path(Path::new("/tmp/x"), None), "/tmp/x");
    }

    #[test]
    fn settings_merge_and_reset_with_null() {
        let dir = temp_dir("settings");
        update_object(&dir, SETTINGS, |s| merge(s, &json!({ "theme": "light", "textSize": 15 }))).unwrap();
        update_object(&dir, SETTINGS, |s| merge(s, &json!({ "textSize": null, "other": true }))).unwrap();
        assert_eq!(Value::Object(read_object(&dir, SETTINGS)), json!({ "theme": "light", "other": true }));
        assert!(!dir.join("settings.json.tmp").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn code_checking_is_remembered_per_folder_and_undecided_until_set() {
        let dir = temp_dir("code-checking");
        let (trusted, other) = (Path::new("/Users/ada/cs336"), Path::new("/Users/ada/Downloads/starter"));
        assert_eq!(code_checking_in(&dir, trusted), None);
        update_object(&dir, STATE, |state| state.insert("layout".into(), json!({ "files": true }))).unwrap();
        set_code_checking_in(&dir, trusted, true).unwrap();
        set_code_checking_in(&dir, other, false).unwrap();
        assert_eq!(code_checking_in(&dir, trusted), Some(true));
        assert_eq!(code_checking_in(&dir, other), Some(false));
        assert_eq!(code_checking_in(&dir, Path::new("/Users/ada/cs336/a1")), None, "a folder inside a trusted one is its own");
        set_code_checking_in(&dir, trusted, false).unwrap();
        assert_eq!(code_checking_in(&dir, trusted), Some(false));
        assert_eq!(read_object(&dir, STATE)["layout"], json!({ "files": true }), "the rest of the state is kept");
        // Anything but true or false there is no decision.
        fs::write(dir.join(STATE), r#"{ "codeChecking": { "/Users/ada/cs336": "yes" } }"#).unwrap();
        assert_eq!(code_checking_in(&dir, trusted), None);
        fs::write(dir.join(STATE), r#"{ "codeChecking": true }"#).unwrap();
        assert_eq!(code_checking_in(&dir, trusted), None);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn unreadable_files_count_as_empty() {
        let dir = temp_dir("corrupt");
        fs::write(dir.join(STATE), "{ not json").unwrap();
        assert!(read_object(&dir, STATE).is_empty());
        fs::write(dir.join(STATE), "[1, 2]").unwrap();
        assert!(read_object(&dir, STATE).is_empty());
        fs::remove_dir_all(dir).unwrap();
    }
}
