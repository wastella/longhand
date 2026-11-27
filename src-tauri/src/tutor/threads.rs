//! Tutor threads kept per folder in `.longhand/threads/<id>.json`: the transcript the student
//! sees, and the CLI session that holds the model's side of it.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The most transcript carried into a new session when the old one cannot be resumed.
const HISTORY_CHARS: usize = 16_000;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Thread {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub created: String,
    pub updated: String,
    /// The policy the session's system prompt was written for.
    #[serde(default)]
    pub policy: String,
    /// The CLI's session id, once the CLI has started that session.
    #[serde(default)]
    pub session: Option<String>,
    #[serde(default)]
    pub messages: Vec<Message>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Message {
    /// "student" or "tutor".
    pub role: String,
    pub text: String,
    pub at: String,
    /// What was attached to a student's message, as short labels.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub context: Vec<String>,
    /// For a tutor message that did not finish: "stopped" or "error".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Summary {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub updated: String,
    pub messages: usize,
}

/// Thread ids become file names, so they are kept to a safe alphabet.
pub fn valid_id(id: &str) -> bool {
    (1..=80).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn dir(ws: &Path) -> PathBuf {
    ws.join(".longhand/threads")
}

pub fn load(ws: &Path, id: &str) -> Option<Thread> {
    if !valid_id(id) {
        return None;
    }
    serde_json::from_str(&fs::read_to_string(dir(ws).join(format!("{id}.json"))).ok()?).ok()
}

/// Loads the thread (or starts it), lets `change` edit it and writes it back. Writes go through
/// one lock and a rename, so concurrent runs never leave a half-written file.
pub fn update(ws: &Path, id: &str, kind: &str, change: impl FnOnce(&mut Thread)) -> std::io::Result<Thread> {
    static WRITING: Mutex<()> = Mutex::new(());
    let _guard = WRITING.lock().unwrap();
    let now = chrono::Local::now().to_rfc3339();
    let mut thread =
        load(ws, id).unwrap_or_else(|| Thread { id: id.into(), kind: kind.into(), created: now.clone(), ..Default::default() });
    change(&mut thread);
    thread.updated = now;
    if thread.title.is_empty() {
        thread.title = thread.messages.iter().find(|m| m.role == "student").map(|m| title_from(&m.text)).unwrap_or_default();
    }
    fs::create_dir_all(dir(ws))?;
    let path = dir(ws).join(format!("{id}.json"));
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_string_pretty(&thread)?)?;
    fs::rename(temp, path)?;
    Ok(thread)
}

fn title_from(text: &str) -> String {
    let line = text.trim().lines().next().unwrap_or("");
    if line.chars().count() <= 80 {
        line.to_string()
    } else {
        format!("{}…", line.chars().take(79).collect::<String>().trim_end())
    }
}

/// The folder's threads whose id starts with `prefix`, most recently used first.
pub fn list(ws: &Path, prefix: &str) -> Vec<Summary> {
    let Ok(entries) = fs::read_dir(dir(ws)) else { return vec![] };
    let mut found: Vec<Summary> = entries
        .filter_map(|e| e.ok()?.file_name().to_str()?.strip_suffix(".json").map(String::from))
        .filter(|id| id.starts_with(prefix))
        .filter_map(|id| load(ws, &id))
        .filter(|t| !t.messages.is_empty())
        .map(|t| Summary { messages: t.messages.len(), id: t.id, kind: t.kind, title: t.title, updated: t.updated })
        .collect();
    found.sort_by(|a, b| b.updated.cmp(&a.updated));
    found
}

/// `messages` as a transcript for a fresh session to read as context. None when there are none.
pub fn history(messages: &[Message]) -> Option<String> {
    let mut kept: Vec<String> = vec![];
    let mut size = 0;
    for m in messages.iter().rev().filter(|m| !m.text.trim().is_empty()) {
        let who = if m.role == "student" { "Student" } else { "Tutor" };
        let turn = format!("{who}: {}", m.text.trim());
        size += turn.len();
        if size > HISTORY_CHARS && !kept.is_empty() {
            break;
        }
        kept.push(turn);
    }
    if kept.is_empty() {
        return None;
    }
    kept.reverse();
    Some(format!(
        "This thread continues an earlier session that could not be resumed. Its transcript, for context only:\n<earlier_conversation>\n{}\n</earlier_conversation>",
        kept.join("\n\n")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::tests::temp_dir;

    fn message(role: &str, text: &str) -> Message {
        Message { role: role.into(), text: text.into(), ..Default::default() }
    }

    #[test]
    fn ids_cannot_leave_the_threads_folder() {
        assert!(valid_id("conv-1f2e") && valid_id("note_tests_test_a"));
        for bad in ["", "../config", "a/b", "a.json", "x y", &"a".repeat(81)] {
            assert!(!valid_id(bad), "{bad}");
        }
        assert_eq!(load(Path::new("/"), "../etc/passwd"), None);
    }

    #[test]
    fn threads_are_saved_titled_and_listed_newest_first() {
        let ws = temp_dir("threads");
        update(&ws, "conv-a", "conversation", |t| t.messages.push(message("student", "What is a causal mask?\nMore."))).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        let b = update(&ws, "conv-b", "conversation", |t| {
            t.messages.push(message("student", &"long ".repeat(40)));
            t.session = Some("s1".into());
        })
        .unwrap();
        update(&ws, "note-c", "review", |t| t.messages.push(message("student", "x"))).unwrap();
        update(&ws, "conv-empty", "conversation", |_| {}).unwrap();

        assert_eq!(load(&ws, "conv-b").unwrap(), b);
        assert!(b.title.ends_with('…') && b.title.chars().count() == 80);
        let listed = list(&ws, "conv-");
        assert_eq!(listed.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), ["conv-b", "conv-a"]);
        assert_eq!(listed[1].title, "What is a causal mask?");
        assert!(!dir(&ws).join("conv-a.json.tmp").exists());
        fs::remove_dir_all(ws).unwrap();
    }

    #[test]
    fn history_keeps_the_latest_turns_within_its_budget() {
        assert_eq!(history(&[]), None);
        let messages =
            vec![message("student", "old question"), message("tutor", &"x".repeat(HISTORY_CHARS - 30)), message("student", "newest")];
        let text = history(&messages).unwrap();
        assert!(text.contains("Student: newest") && text.contains("Tutor: xxx"));
        assert!(!text.contains("old question"));
        assert!(text.starts_with("This thread continues") && text.ends_with("</earlier_conversation>"));
    }
}
