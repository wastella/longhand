//! What the file tree remembers about each folder (which folders were expanded, recently opened
//! files), kept in one small file in the app's data directory rather than in the student's folder.

use crate::workspace::{err, R};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::Path;

/// Folders beyond this many, least recently saved first, are forgotten.
const MAX_FOLDERS: usize = 30;
/// Memory for one folder is a few lists of paths; anything bigger is a mistake.
const MAX_BYTES: usize = 64 * 1024;

fn read_store(store: &Path) -> Map<String, Value> {
    fs::read_to_string(store).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

/// What was saved for `folder`, or null.
pub fn load(store: &Path, folder: &str) -> Value {
    read_store(store).remove(folder).map(|entry| entry["memory"].clone()).unwrap_or(Value::Null)
}

pub fn save(store: &Path, folder: &str, memory: Value, now_ms: i64) -> R<()> {
    if !memory.is_object() || memory.to_string().len() > MAX_BYTES {
        return Err("The file tree's memory is not a small object".into());
    }
    let mut folders = read_store(store);
    folders.insert(folder.to_string(), json!({ "memory": memory, "at": now_ms }));
    if folders.len() > MAX_FOLDERS {
        let mut by_age: Vec<(i64, String)> = folders.iter().map(|(k, v)| (v["at"].as_i64().unwrap_or(0), k.clone())).collect();
        by_age.sort();
        for (_, k) in by_age.into_iter().take(folders.len() - MAX_FOLDERS) {
            folders.remove(&k);
        }
    }
    if let Some(dir) = store.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    fs::write(store, Value::Object(folders).to_string()).map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::tests::temp_dir;

    #[test]
    fn remembers_each_folder_separately_and_forgets_the_oldest() {
        let dir = temp_dir("memory");
        let store = dir.join("nested/tree-memory.json");
        assert_eq!(load(&store, "/a"), Value::Null);
        save(&store, "/a", json!({ "expanded": ["src"] }), 1).unwrap();
        save(&store, "/b", json!({ "expanded": [] }), 2).unwrap();
        assert_eq!(load(&store, "/a"), json!({ "expanded": ["src"] }));

        for i in 0..MAX_FOLDERS {
            save(&store, &format!("/later/{i}"), json!({}), 10 + i as i64).unwrap();
        }
        assert_eq!(load(&store, "/a"), Value::Null, "the oldest folders were forgotten");
        assert_eq!(load(&store, "/later/0"), json!({}));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refuses_anything_but_a_small_object() {
        let dir = temp_dir("memory-bad");
        let store = dir.join("m.json");
        assert!(save(&store, "/a", json!([1]), 0).is_err());
        assert!(save(&store, "/a", json!({ "x": "y".repeat(MAX_BYTES) }), 0).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
