//! Margin notes from the tutor's reviews, kept per folder in `.longhand/notes.json` so they come
//! back when a file is reopened. The interface decides where a note sits (by its line range and
//! the text of those lines); this module only keeps the list.
//!
//! Like everything in `.longhand/`, the file is untrusted: a starter repository can ship it. A
//! loaded note keeps only fields Longhand writes, from their allow-lists and within their caps.
//! Its text is shown through the interface's sanitizing renderer, never as markup.

use crate::workspace::{longhand_dir, workspace, AppState};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::State;

const MAX_NOTES: usize = 500;
const MAX_TEXT_CHARS: usize = 4_000;
const MAX_ANCHOR_LINES: usize = 80;
const MAX_ANCHOR_LINE_CHARS: usize = 400;
const MAX_PATH_CHARS: usize = 400;
const MAX_LINE: u32 = 1_000_000;
/// A notes file larger than this was not written by Longhand and is not read.
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;

const KINDS: [&str; 5] = ["question", "bug", "fragile", "clarity", "good"];
const STATUSES: [&str; 2] = ["open", "resolved"];

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    /// The file, relative to the open folder.
    pub path: String,
    pub from_line: u32,
    pub to_line: u32,
    /// The text of the lines the note is about, when it was last placed.
    #[serde(default)]
    pub anchor: Vec<String>,
    #[serde(default)]
    pub kind: String,
    pub text: String,
    #[serde(default)]
    pub status: String,
    /// The tutor thread for replies to this note.
    #[serde(default)]
    pub thread: String,
    /// How many replies the thread holds, so a note without any never loads it.
    #[serde(default)]
    pub replies: u32,
    #[serde(default)]
    pub created: String,
}

#[derive(Serialize, Deserialize, Default)]
struct NotesFile {
    #[serde(default)]
    notes: Vec<Note>,
}

/// Ids and thread ids name files and DOM data, so they are kept to the threads' safe alphabet.
fn valid_id(id: &str) -> bool {
    (1..=80).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A path inside the folder, written the way the interface writes them.
fn valid_path(path: &str) -> bool {
    !path.is_empty()
        && path.chars().count() <= MAX_PATH_CHARS
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.chars().any(char::is_control)
        && path.split('/').all(|part| !part.is_empty() && part != "." && part != "..")
}

fn truncate(text: &mut String, max: usize) {
    if let Some((cut, _)) = text.char_indices().nth(max) {
        text.truncate(cut);
        text.push('…');
    }
}

/// The note as Longhand would have written it, or None when it cannot be one.
fn sanitize(mut note: Note) -> Option<Note> {
    let lines_ok = note.from_line >= 1 && note.from_line <= note.to_line && note.to_line <= MAX_LINE;
    if !valid_id(&note.id) || !valid_path(&note.path) || !lines_ok || note.text.trim().is_empty() {
        return None;
    }
    if !KINDS.contains(&note.kind.as_str()) {
        note.kind = "question".into();
    }
    if !STATUSES.contains(&note.status.as_str()) {
        note.status = "open".into();
    }
    if !valid_id(&note.thread) {
        note.thread = String::new();
        note.replies = 0;
    }
    truncate(&mut note.text, MAX_TEXT_CHARS);
    note.anchor.truncate(MAX_ANCHOR_LINES);
    note.anchor.iter_mut().for_each(|line| truncate(line, MAX_ANCHOR_LINE_CHARS));
    note.created.truncate(40);
    Some(note)
}

fn file(ws: &Path) -> std::path::PathBuf {
    ws.join(".longhand/notes.json")
}

pub fn load(ws: &Path) -> Vec<Note> {
    let path = file(ws);
    if fs::metadata(&path).map_or(true, |m| m.len() > MAX_FILE_BYTES) {
        return vec![];
    }
    let Some(saved) = fs::read_to_string(path).ok().and_then(|s| serde_json::from_str::<NotesFile>(&s).ok()) else {
        return vec![];
    };
    saved.notes.into_iter().filter_map(sanitize).take(MAX_NOTES).collect()
}

/// Replaces the folder's notes. Written beside the file and renamed over it, under one lock, so
/// a crash or two quick saves never leave half a file.
pub fn save(ws: &Path, notes: Vec<Note>) -> std::io::Result<()> {
    static WRITING: Mutex<()> = Mutex::new(());
    let _guard = WRITING.lock().unwrap();
    let notes: Vec<Note> = notes.into_iter().filter_map(sanitize).take(MAX_NOTES).collect();
    longhand_dir(ws)?;
    let path = file(ws);
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_string_pretty(&NotesFile { notes })?)?;
    fs::rename(temp, path)
}

// ---- commands ----

/// The open folder's margin notes.
#[tauri::command]
pub fn feedback_notes_load(state: State<AppState>) -> Result<Vec<Note>, String> {
    Ok(load(&workspace(&state)?))
}

/// Replaces the open folder's margin notes with `notes`.
#[tauri::command]
pub fn feedback_notes_save(state: State<AppState>, notes: Vec<Note>) -> Result<(), String> {
    let ws = workspace(&state)?;
    save(&ws, notes).map_err(|e| format!("Could not save the tutor's notes in .longhand/notes.json: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::tests::temp_dir;

    fn note(id: &str) -> Note {
        Note {
            id: id.into(),
            path: "stats/running.py".into(),
            from_line: 12,
            to_line: 14,
            anchor: vec!["delta = x - self.mean".into()],
            kind: "question".into(),
            text: "Which mean is delta measured from?".into(),
            status: "open".into(),
            thread: format!("note-{id}"),
            replies: 2,
            created: "2026-11-27T10:00:00+00:00".into(),
        }
    }

    #[test]
    fn notes_are_kept_and_read_back() {
        let ws = temp_dir("notes");
        assert_eq!(load(&ws), vec![]);
        save(&ws, vec![note("a"), Note { status: "resolved".into(), kind: "good".into(), ..note("b") }]).unwrap();
        let loaded = load(&ws);
        assert_eq!(loaded, vec![note("a"), Note { status: "resolved".into(), kind: "good".into(), ..note("b") }]);
        assert!(!ws.join(".longhand/notes.json.tmp").exists());
        assert_eq!(fs::read_to_string(ws.join(".longhand/.gitignore")).unwrap(), "*\n");
        // The interface writes camelCase, as it reads.
        assert!(fs::read_to_string(file(&ws)).unwrap().contains("\"fromLine\": 12"));
        fs::remove_dir_all(ws).unwrap();
    }

    #[test]
    fn a_hostile_notes_file_loses_what_longhand_would_not_have_written() {
        let ws = temp_dir("notes-hostile");
        fs::create_dir_all(ws.join(".longhand")).unwrap();
        let hostile = serde_json::json!({ "notes": [
            { "id": "../x", "path": "a.py", "fromLine": 1, "toLine": 1, "text": "t" },
            { "id": "a", "path": "../../etc/passwd", "fromLine": 1, "toLine": 1, "text": "t" },
            { "id": "b", "path": "/etc/passwd", "fromLine": 1, "toLine": 1, "text": "t" },
            { "id": "c", "path": "a.py", "fromLine": 5, "toLine": 2, "text": "t" },
            { "id": "d", "path": "a.py", "fromLine": 0, "toLine": 2, "text": "t" },
            { "id": "e", "path": "a.py", "fromLine": 1, "toLine": 2, "text": "  " },
            { "id": "f", "path": "a.py", "fromLine": 1, "toLine": 2, "text": "kept", "kind": "<script>",
              "status": "pwned", "thread": "--resume=x", "replies": 9, "extra": "ignored" },
        ]});
        fs::write(file(&ws), hostile.to_string()).unwrap();
        let loaded = load(&ws);
        assert_eq!(loaded.len(), 1);
        let f = &loaded[0];
        assert_eq!((f.id.as_str(), f.kind.as_str(), f.status.as_str(), f.thread.as_str(), f.replies), ("f", "question", "open", "", 0));

        // Malformed and oversized files are not read.
        fs::write(file(&ws), "{ not json").unwrap();
        assert_eq!(load(&ws), vec![]);
        fs::write(file(&ws), " ".repeat(MAX_FILE_BYTES as usize + 1)).unwrap();
        assert_eq!(load(&ws), vec![]);
        fs::remove_dir_all(ws).unwrap();
    }

    #[test]
    fn notes_stay_within_their_caps() {
        let ws = temp_dir("notes-caps");
        let long = Note {
            text: "x".repeat(MAX_TEXT_CHARS + 10),
            anchor: vec!["y".repeat(MAX_ANCHOR_LINE_CHARS + 10); MAX_ANCHOR_LINES + 10],
            ..note("long")
        };
        let many: Vec<Note> = (0..MAX_NOTES + 20).map(|i| note(&format!("n{i}"))).collect();
        save(&ws, [vec![long], many].concat()).unwrap();
        let loaded = load(&ws);
        assert_eq!(loaded.len(), MAX_NOTES);
        assert_eq!(loaded[0].text.chars().count(), MAX_TEXT_CHARS + 1);
        assert_eq!(loaded[0].anchor.len(), MAX_ANCHOR_LINES);
        assert_eq!(loaded[0].anchor[0].chars().count(), MAX_ANCHOR_LINE_CHARS + 1);
        fs::remove_dir_all(ws).unwrap();
    }

    #[test]
    fn paths_stay_inside_the_folder() {
        for good in ["a.py", "stats/running.py", "tests/test_a b.py", ".hidden/x.py"] {
            assert!(valid_path(good), "{good}");
        }
        for bad in ["", "/abs.py", "a/../b.py", "./a.py", "a//b.py", "a\\b.py", "a\nb.py", "a/"] {
            assert!(!valid_path(bad), "{bad:?}");
        }
    }
}
