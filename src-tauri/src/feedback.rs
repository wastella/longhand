//! Margin notes from the tutor's reviews, kept per folder in `.longhand/notes.json` so they come
//! back when a file is reopened. The interface decides where a note sits (by its line range and
//! the text of those lines); this module only keeps the list.
//!
//! Like everything in `.longhand/`, the file is untrusted: a starter repository can ship it. A
//! loaded note keeps only fields Longhand writes, from their allow-lists and within their caps.
//! Its text is shown through the interface's sanitizing renderer, never as markup.

use crate::tutor::threads;
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
    /// The review the note came from, so the code in one review's notes is checked together.
    #[serde(default)]
    pub review: String,
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

/// A timestamp as the interface writes them (`toISOString()`): ASCII digits and separators only,
/// so nothing in it can be multibyte or markup.
fn valid_created(created: &str) -> bool {
    (1..=40).contains(&created.len()) && created.bytes().all(|b| b.is_ascii_digit() || b"-:.TZ+".contains(&b))
}

/// Cuts `text` to `max` characters (never inside one), marking the cut.
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
    // A note's replies live on the thread the interface names after it, and only that one: a
    // planted file must not attach some other conversation to a note.
    if note.thread != format!("note-{}", note.id) {
        note.thread = String::new();
        note.replies = 0;
    }
    truncate(&mut note.text, MAX_TEXT_CHARS);
    note.anchor.truncate(MAX_ANCHOR_LINES);
    note.anchor.iter_mut().for_each(|line| truncate(line, MAX_ANCHOR_LINE_CHARS));
    if !note.review.is_empty() && !valid_id(&note.review) {
        note.review = String::new();
    }
    if !valid_created(&note.created) {
        note.created = String::new();
    }
    Some(note)
}

fn file(ws: &Path) -> std::path::PathBuf {
    ws.join(".longhand/notes.json")
}

/// The folder's notes, or None when the file exists but cannot be read as notes.
fn read(ws: &Path) -> Option<Vec<Note>> {
    let path = file(ws);
    let Ok(meta) = fs::metadata(&path) else { return Some(vec![]) };
    if meta.len() > MAX_FILE_BYTES {
        return None;
    }
    let saved = fs::read_to_string(path).ok().and_then(|s| serde_json::from_str::<NotesFile>(&s).ok())?;
    Some(saved.notes.into_iter().filter_map(sanitize).take(MAX_NOTES).collect())
}

#[cfg(test)]
fn load(ws: &Path) -> Vec<Note> {
    read(ws).unwrap_or_default()
}

/// Thread files this area writes: a note's replies, an explanation, help on a failing test.
const THREAD_PREFIXES: [&str; 3] = ["note-", "explain-", "fail-"];

/// Deletes the thread files `ids` (only ones this area names), for notes that were removed.
pub fn forget_threads(ws: &Path, ids: &[String]) {
    for id in ids {
        if threads::valid_id(id) && THREAD_PREFIXES.iter().any(|p| id.starts_with(p)) {
            let _ = fs::remove_file(ws.join(".longhand/threads").join(format!("{id}.json")));
        }
    }
}

/// On opening a folder: thread files no note or panel can show again go. Explanations and
/// failure help last one session; a note's replies last as long as the note.
fn prune_threads(ws: &Path, notes: &[Note]) {
    let Ok(entries) = fs::read_dir(ws.join(".longhand/threads")) else { return };
    let stale: Vec<String> = entries
        .flatten()
        .filter_map(|e| e.file_name().to_str()?.strip_suffix(".json").map(str::to_string))
        .filter(|id| {
            id.starts_with("explain-") || id.starts_with("fail-") || (id.starts_with("note-") && !notes.iter().any(|n| &n.thread == id))
        })
        .collect();
    forget_threads(ws, &stale);
}

/// Replaces the folder's notes. Written beside the file and renamed over it, under one lock, so
/// a crash or two quick saves never leave half a file.
pub fn save(ws: &Path, notes: Vec<Note>) -> std::io::Result<()> {
    static WRITING: Mutex<()> = Mutex::new(());
    // The lock guards no data, so a panic elsewhere while holding it leaves nothing to distrust.
    let _guard = WRITING.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let notes: Vec<Note> = notes.into_iter().filter_map(sanitize).take(MAX_NOTES).collect();
    longhand_dir(ws)?;
    let path = file(ws);
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_string_pretty(&NotesFile { notes })?)?;
    fs::rename(temp, path)
}

// ---- commands ----

/// The open folder's margin notes. Thread files left by earlier sessions that nothing can show
/// again are deleted; nothing is deleted when the notes file cannot be read.
#[tauri::command]
pub fn feedback_notes_load(state: State<AppState>) -> Result<Vec<Note>, String> {
    let ws = workspace(&state)?;
    let Some(notes) = read(&ws) else { return Ok(vec![]) };
    prune_threads(&ws, &notes);
    Ok(notes)
}

/// The open folder, if it is `folder`: a save or deletion queued for one folder must never land
/// in the next.
fn same_folder(state: &AppState, folder: &str) -> Result<Option<std::path::PathBuf>, String> {
    let ws = workspace(state)?;
    Ok((ws == Path::new(folder)).then_some(ws))
}

/// Replaces the margin notes of `folder` (which must still be the open folder) with `notes`.
#[tauri::command]
pub fn feedback_notes_save(state: State<AppState>, folder: String, notes: Vec<Note>) -> Result<(), String> {
    let Some(ws) = same_folder(&state, &folder)? else { return Ok(()) };
    save(&ws, notes).map_err(|e| format!("Could not save the tutor's notes in .longhand/notes.json: {e}"))
}

/// Deletes the thread files `ids` of notes that were removed from `folder`.
#[tauri::command]
pub fn feedback_threads_forget(state: State<AppState>, folder: String, ids: Vec<String>) -> Result<(), String> {
    if let Some(ws) = same_folder(&state, &folder)? {
        forget_threads(&ws, &ids);
    }
    Ok(())
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
            review: "review-abc".into(),
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
    fn multibyte_and_garbage_fields_never_panic() {
        let ws = temp_dir("notes-garbage");
        fs::create_dir_all(ws.join(".longhand")).unwrap();
        // A multibyte character straddling every cut the sanitiser makes.
        let wide = "é".repeat(MAX_TEXT_CHARS + 3);
        let hostile = serde_json::json!({ "notes": [
            { "id": "a", "path": "a.py", "fromLine": 1, "toLine": 1, "text": wide, "created": format!("{}é{}", "1".repeat(39), "é".repeat(30)),
              "anchor": ["€".repeat(MAX_ANCHOR_LINE_CHARS + 1)], "thread": "note-a", "replies": 1 },
            { "id": "é", "path": "a.py", "fromLine": 1, "toLine": 1, "text": "t" },
            { "id": "b", "path": "é/ü.py", "fromLine": 1, "toLine": 1, "text": "🙂", "created": "<img src=x>", "thread": "note-a", "replies": 3 },
            { "id": "c", "path": "a.py", "fromLine": 4294967295u32, "toLine": 4294967295u32, "text": "t" },
            { "id": "d", "path": "a.py", "fromLine": 1, "toLine": 1, "text": "t", "kind": 5, "status": null },
        ]});
        fs::write(file(&ws), hostile.to_string()).unwrap();
        // A wrongly typed field makes the whole file unreadable, which loads as no notes.
        assert_eq!(load(&ws), vec![]);
        let mut fixed = hostile.clone();
        fixed["notes"].as_array_mut().unwrap().pop();
        fs::write(file(&ws), fixed.to_string()).unwrap();
        let loaded = load(&ws);
        assert_eq!(loaded.iter().map(|n| n.id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        assert_eq!(loaded[0].created, "");
        assert_eq!(loaded[0].text.chars().count(), MAX_TEXT_CHARS + 1);
        assert_eq!(loaded[0].anchor[0].chars().count(), MAX_ANCHOR_LINE_CHARS + 1);
        assert_eq!((loaded[0].thread.as_str(), loaded[0].replies), ("note-a", 1));
        assert_eq!(
            (loaded[1].created.as_str(), loaded[1].thread.as_str(), loaded[1].replies),
            ("", "", 0),
            "another note's thread is not attached"
        );
        // Saving the same garbage goes through the same checks and does not panic either.
        save(&ws, loaded).unwrap();
        save(&ws, vec![Note { created: "é".repeat(50), ..note("z") }]).unwrap();
        assert_eq!(load(&ws)[0].created, "");
        fs::remove_dir_all(ws).unwrap();
    }

    #[test]
    fn only_this_areas_stale_threads_are_deleted() {
        let ws = temp_dir("notes-threads");
        let dir = ws.join(".longhand/threads");
        fs::create_dir_all(&dir).unwrap();
        for id in ["note-a", "note-gone", "explain-x", "fail-y", "conv-z", "lookup-w"] {
            fs::write(dir.join(format!("{id}.json")), "{}").unwrap();
        }
        prune_threads(&ws, &[note("a")]);
        let mut left: Vec<String> = fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
        left.sort();
        assert_eq!(left, ["conv-z.json", "lookup-w.json", "note-a.json"]);
        // Only this area's threads, by a safe id, can be named for deletion.
        forget_threads(&ws, &["conv-z".into(), "../notes".into(), "note-a".into()]);
        assert!(dir.join("conv-z.json").exists());
        assert!(!dir.join("note-a.json").exists());
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
