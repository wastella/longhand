//! Reading and saving the files open in the editor. A file is saved exactly as the student left
//! it: its line endings and byte-order mark are kept, and nothing is reformatted.

use crate::files::in_workspace;
use crate::workspace::{AppState, R};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::{self, File, Metadata};
use std::io::{self, ErrorKind, Read, Write};
use std::path::Path;
use tauri::State;

/// Larger files open as a notice instead of text. Coursework folders hold multi-gigabyte data
/// files and checkpoints, and nobody edits a file this size by hand.
const MAX_TEXT_BYTES: u64 = 3 * 1024 * 1024;
/// How much of a file is checked for NUL bytes when deciding whether it is binary.
const BINARY_PROBE_BYTES: u64 = 8000;
const BOM: &[u8] = b"\xEF\xBB\xBF";

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
}

/// How a file's text is laid out on disk, so saving can write it back the same way. The editor
/// works with `\n` line breaks and no byte-order mark.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Format {
    line_ending: LineEnding,
    bom: bool,
}

/// Reads a file for the editor. The result's `kind` is `text` (with `text`, `mtime` and
/// `format`), or `missing`, `binary`, `tooLarge` or `notText` (with `size`) for a file the
/// editor shows a notice for instead.
#[tauri::command]
pub async fn doc_read(state: State<'_, AppState>, rel: String) -> R<Value> {
    let path = in_workspace(&state, &rel)?;
    read_document(&path).map_err(|e| describe(&e, &rel, "open"))
}

/// Saves `text` in `format`. When `expected_mtime` is given and the file changed or vanished
/// since then, nothing is written and the result's `status` says `changed` or `deleted`;
/// otherwise it is `saved`, with the new `mtime`.
#[tauri::command]
pub async fn doc_write(state: State<'_, AppState>, rel: String, text: String, format: Format, expected_mtime: Option<f64>) -> R<Value> {
    let path = in_workspace(&state, &rel)?;
    save_document(&path, &text, format, expected_mtime).map_err(|e| describe(&e, &rel, "save"))
}

/// The modification time of each path, for noticing changes made outside the editor: `{ mtime }`,
/// `{ missing: true }`, or `{ error }` when the file exists but cannot be checked.
#[tauri::command]
pub async fn doc_stat(state: State<'_, AppState>, paths: Vec<String>) -> R<Vec<Value>> {
    Ok(paths
        .iter()
        .map(|rel| match in_workspace(&state, rel) {
            Ok(path) => stat(&path).unwrap_or_else(|e| json!({ "error": describe(&e, rel, "check") })),
            Err(e) => json!({ "error": e }),
        })
        .collect())
}

fn stat(path: &Path) -> io::Result<Value> {
    match fs::metadata(path) {
        Ok(meta) => Ok(json!({ "mtime": mtime(&meta) })),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(json!({ "missing": true })),
        Err(e) => Err(e),
    }
}

fn save_document(path: &Path, text: &str, format: Format, expected_mtime: Option<f64>) -> io::Result<Value> {
    if let Some(expected) = expected_mtime {
        match fs::metadata(path) {
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(json!({ "status": "deleted" })),
            Err(e) => return Err(e),
            Ok(meta) if changed(mtime(&meta), expected) => return Ok(json!({ "status": "changed" })),
            Ok(_) => {}
        }
    }
    write_atomically(path, &encode(text, format))?;
    Ok(json!({ "status": "saved", "mtime": mtime(&fs::metadata(path)?) }))
}

fn mtime(meta: &Metadata) -> f64 {
    meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

/// File systems round modification times differently; within a millisecond counts as the same.
fn changed(on_disk: f64, expected: f64) -> bool {
    (on_disk - expected).abs() > 1.0
}

fn read_document(path: &Path) -> io::Result<Value> {
    let meta = match fs::metadata(path) {
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(json!({ "kind": "missing" })),
        result => result?,
    };
    let size = meta.len();
    if size > MAX_TEXT_BYTES {
        // Only the start is read, so a multi-gigabyte file costs no more than a small one.
        let mut start = Vec::new();
        File::open(path)?.take(BINARY_PROBE_BYTES).read_to_end(&mut start)?;
        let kind = if looks_binary(&start) { "binary" } else { "tooLarge" };
        return Ok(json!({ "kind": kind, "size": size }));
    }
    Ok(classify(fs::read(path)?, mtime(&meta)))
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(BINARY_PROBE_BYTES as usize).any(|b| *b == 0)
}

fn classify(mut bytes: Vec<u8>, mtime: f64) -> Value {
    let size = bytes.len();
    if looks_binary(&bytes) {
        return json!({ "kind": "binary", "size": size });
    }
    let bom = bytes.starts_with(BOM);
    if bom {
        bytes.drain(..BOM.len());
    }
    // Text that is not UTF-8 would be changed by saving it, so it is not opened at all.
    match String::from_utf8(bytes) {
        Err(_) => json!({ "kind": "notText", "size": size }),
        Ok(text) => {
            let format = Format { line_ending: detect_line_ending(&text), bom };
            json!({ "kind": "text", "text": text, "mtime": mtime, "format": format })
        }
    }
}

/// The line ending most lines use. A file with no line breaks counts as `\n`.
fn detect_line_ending(text: &str) -> LineEnding {
    let crlf = text.matches("\r\n").count();
    let lf = text.matches('\n').count() - crlf;
    if crlf > lf {
        LineEnding::Crlf
    } else {
        LineEnding::Lf
    }
}

fn encode(text: &str, format: Format) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() + BOM.len());
    if format.bom {
        out.extend_from_slice(BOM);
    }
    match format.line_ending {
        LineEnding::Lf => out.extend_from_slice(text.as_bytes()),
        LineEnding::Crlf => out.extend_from_slice(text.replace("\r\n", "\n").replace('\n', "\r\n").as_bytes()),
    }
    out
}

/// Writes beside the file and renames over it, so a full disk or a crash halfway through leaves
/// the old contents intact rather than a truncated file.
fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    // Through a symlink, the file it points to is the one to replace.
    let target = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let existing = fs::metadata(&target).ok();
    if existing.as_ref().is_some_and(|m| m.permissions().readonly()) {
        return Err(ErrorKind::PermissionDenied.into());
    }
    let dir = target.parent().ok_or(ErrorKind::InvalidInput)?;
    let name = target.file_name().ok_or(ErrorKind::InvalidInput)?.to_string_lossy();
    // A file saved again after it was deleted may have lost its folder too.
    fs::create_dir_all(dir)?;
    let temp = dir.join(format!(".{name}.longhand-save"));
    let result = (|| {
        let mut file = File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        if let Some(meta) = &existing {
            fs::set_permissions(&temp, meta.permissions())?;
        }
        fs::rename(&temp, &target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

/// A message a student can act on, for a failure to `verb` (open, save, check) the file `rel`.
fn describe(e: &io::Error, rel: &str, verb: &str) -> String {
    match e.kind() {
        ErrorKind::PermissionDenied => format!("You don't have permission to {verb} {rel}. Check who owns it and whether it is read-only."),
        ErrorKind::NotFound => format!("{rel} no longer exists."),
        ErrorKind::IsADirectory => format!("{rel} is a folder, not a file."),
        _ if e.raw_os_error() == Some(libc::ENOSPC) => {
            format!("The disk is full, so {rel} could not be saved. Free some space and save again.")
        }
        _ => format!("Could not {verb} {rel}: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::tests::temp_dir;

    const LF: Format = Format { line_ending: LineEnding::Lf, bom: false };

    #[test]
    fn line_endings_follow_most_lines() {
        assert_eq!(detect_line_ending("a\nb\n"), LineEnding::Lf);
        assert_eq!(detect_line_ending("a\r\nb\r\n"), LineEnding::Crlf);
        assert_eq!(detect_line_ending("a\r\nb\r\nc\n"), LineEnding::Crlf);
        assert_eq!(detect_line_ending("a\r\nb\nc\n"), LineEnding::Lf);
        assert_eq!(detect_line_ending("no break"), LineEnding::Lf);
    }

    #[test]
    fn saving_keeps_line_endings_bom_and_final_newline() {
        let crlf = Format { line_ending: LineEnding::Crlf, bom: false };
        assert_eq!(encode("a\nb\n", crlf), b"a\r\nb\r\n");
        assert_eq!(encode("a\nb", crlf), b"a\r\nb");
        assert_eq!(encode("a\nb", LF), b"a\nb");
        assert_eq!(encode("x\n", Format { line_ending: LineEnding::Lf, bom: true }), b"\xEF\xBB\xBFx\n");
    }

    #[test]
    fn reading_round_trips_through_saving() {
        for original in [&b"a\r\nb\r\n"[..], b"\xEF\xBB\xBFa\nb", b"one line"] {
            let read = classify(original.to_vec(), 0.0);
            let format: Format = serde_json::from_value(read["format"].clone()).unwrap();
            let text = read["text"].as_str().unwrap().replace("\r\n", "\n");
            assert_eq!(encode(&text, format), original);
        }
    }

    #[test]
    fn binary_and_non_utf8_files_are_not_opened_as_text() {
        assert_eq!(classify(b"PK\x03\x04\x00\x00".to_vec(), 0.0)["kind"], "binary");
        assert_eq!(classify(b"caf\xE9\n".to_vec(), 0.0)["kind"], "notText");
        assert_eq!(classify(b"print('hi')\n".to_vec(), 0.0)["kind"], "text");
    }

    #[test]
    fn large_files_are_classified_from_their_start() {
        let dir = temp_dir("large");
        let text = dir.join("big.csv");
        fs::write(&text, "1,2,3\n".repeat(600_000)).unwrap();
        assert_eq!(read_document(&text).unwrap()["kind"], "tooLarge");
        let binary = dir.join("model.pt");
        let mut bytes = vec![0u8; 16];
        bytes.resize(MAX_TEXT_BYTES as usize + 1, 7);
        fs::write(&binary, bytes).unwrap();
        assert_eq!(read_document(&binary).unwrap()["kind"], "binary");
        assert_eq!(read_document(&dir.join("gone.py")).unwrap()["kind"], "missing");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn saving_replaces_the_file_and_leaves_no_temporary_file() {
        let dir = temp_dir("save");
        let file = dir.join("a.py");
        fs::write(&file, "old\n").unwrap();
        write_atomically(&file, b"new\n").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "new\n");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn saving_recreates_a_deleted_folder() {
        let dir = temp_dir("recreate");
        let file = dir.join("gone/a.py");
        write_atomically(&file, b"x = 1\n").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "x = 1\n");
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn saving_writes_through_a_symlink() {
        let dir = temp_dir("symlink");
        fs::write(dir.join("real.py"), "old\n").unwrap();
        std::os::unix::fs::symlink(dir.join("real.py"), dir.join("link.py")).unwrap();
        write_atomically(&dir.join("link.py"), b"new\n").unwrap();
        assert_eq!(fs::read_to_string(dir.join("real.py")).unwrap(), "new\n");
        assert!(fs::symlink_metadata(dir.join("link.py")).unwrap().file_type().is_symlink());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_read_only_file_is_not_replaced() {
        let dir = temp_dir("readonly");
        let file = dir.join("a.py");
        fs::write(&file, "old\n").unwrap();
        let mut perms = fs::metadata(&file).unwrap().permissions();
        perms.set_readonly(true);
        fs::set_permissions(&file, perms.clone()).unwrap();
        let e = write_atomically(&file, b"new\n").unwrap_err();
        assert!(describe(&e, "a.py", "save").starts_with("You don't have permission to save a.py"));
        assert_eq!(fs::read_to_string(&file).unwrap(), "old\n");
        #[allow(clippy::permissions_set_readonly_false)]
        perms.set_readonly(false);
        fs::set_permissions(&file, perms).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn saving_refuses_to_overwrite_a_file_changed_or_deleted_since_it_was_read() {
        let dir = temp_dir("conflict");
        let file = dir.join("a.py");
        fs::write(&file, "theirs\n").unwrap();
        let read_at = stat(&file).unwrap()["mtime"].as_f64().unwrap();
        assert_eq!(save_document(&file, "mine\n", LF, Some(read_at - 5000.0)).unwrap()["status"], "changed");
        assert_eq!(fs::read_to_string(&file).unwrap(), "theirs\n");

        let saved = save_document(&file, "mine\n", LF, Some(read_at)).unwrap();
        assert_eq!(saved["status"], "saved");
        assert_eq!(stat(&file).unwrap()["mtime"], saved["mtime"]);
        assert_eq!(fs::read_to_string(&file).unwrap(), "mine\n");

        fs::remove_file(&file).unwrap();
        assert_eq!(stat(&file).unwrap(), json!({ "missing": true }));
        assert_eq!(save_document(&file, "mine\n", LF, Some(read_at)).unwrap()["status"], "deleted");
        // Without an expected time the save goes ahead: the student chose to write it back.
        assert_eq!(save_document(&file, "mine\n", LF, None).unwrap()["status"], "saved");
        assert_eq!(fs::read_to_string(&file).unwrap(), "mine\n");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn modification_times_within_a_millisecond_are_the_same() {
        assert!(!changed(1000.0, 1000.6));
        assert!(changed(1002.0, 1000.0));
        assert!(changed(900.0, 1000.0));
    }
}
