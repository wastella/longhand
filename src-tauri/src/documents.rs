//! Reading and saving the files open in the editor. A file is saved exactly as the student left
//! it: the editor puts back each line's own ending, this module puts back the byte-order mark,
//! and nothing is reformatted.
//!
//! Every command does its file system work on a blocking thread, so a slow or hung network
//! mount holds up only that command, not the rest of the backend.

use crate::files::resolve_in;
use crate::workspace::{workspace, AppState, R};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{self, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::State;

/// Larger files open as a notice instead of text. Coursework folders hold multi-gigabyte data
/// files and checkpoints, and nobody edits a file this size by hand.
const MAX_TEXT_BYTES: u64 = 3 * 1024 * 1024;
/// Notebooks carry their outputs (plots, tables) as text, so they get more room.
const MAX_NOTEBOOK_BYTES: u64 = 20 * 1024 * 1024;

/// The largest file at `path` that opens as text.
fn text_limit(path: &Path) -> u64 {
    if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("ipynb")) {
        MAX_NOTEBOOK_BYTES
    } else {
        MAX_TEXT_BYTES
    }
}

/// How much of a file is checked for NUL bytes when deciding whether it is binary.
const BINARY_PROBE_BYTES: u64 = 8000;
const BOM: &[u8] = b"\xEF\xBB\xBF";
/// Saving writes `.<name>.longhand-save-<random>` beside the file, then renames it over the file.
const TEMP_MARK: &str = ".longhand-save";
/// A temporary file this old was left by a save that crashed, and is removed on the next save.
const STALE_TEMP_AGE: Duration = Duration::from_secs(60);

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
    Cr,
}

/// How a file's text is laid out on disk. `line_ending` is the one most lines use, which the
/// editor gives new lines; the editor keeps every other line's own ending itself.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Format {
    line_ending: LineEnding,
    bom: bool,
}

/// One version of a file on disk. The size is compared as well as the time, because some file
/// systems keep whole seconds, and a formatter run in the same second as a save would be missed.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)]
pub struct Stamp {
    mtime: f64,
    size: u64,
}

impl Stamp {
    fn of(meta: &Metadata) -> Stamp {
        let mtime = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as f64);
        Stamp { mtime: mtime.unwrap_or(0.0), size: meta.len() }
    }

    /// File systems round modification times differently; within a millisecond counts as the same.
    fn differs(&self, other: &Stamp) -> bool {
        (self.mtime - other.mtime).abs() > 1.0 || self.size != other.size
    }
}

/// Runs file system work on a blocking thread.
async fn blocking<T: Send + 'static>(job: impl FnOnce() -> T + Send + 'static) -> R<T> {
    tauri::async_runtime::spawn_blocking(job).await.map_err(|e| e.to_string())
}

/// Reads a file for the editor. The result's `kind` is `text` (with `text` as it is on disk,
/// `mtime`, `size` and `format`), or `missing`, or `binary`, `tooLarge` or `notText` (with
/// `mtime` and `size`) for a file the editor shows a notice for instead.
#[tauri::command]
pub async fn doc_read(state: State<'_, AppState>, rel: String) -> R<Value> {
    let ws = workspace(&state)?;
    blocking(move || read_document(&resolve_in(&ws, &rel)?).map_err(|e| describe(&e, &rel, "open"))).await?
}

/// Saves `text` (with its line endings already in place) and the byte-order mark `format` asks
/// for. When `expected` is given and the file changed or vanished since then, nothing is written
/// and the result's `status` says `changed` or `deleted`; otherwise it is `saved`, with the new
/// `mtime` and `size`.
#[tauri::command]
pub async fn doc_write(state: State<'_, AppState>, rel: String, text: String, format: Format, expected: Option<Stamp>) -> R<Value> {
    let ws = workspace(&state)?;
    blocking(move || save_document(&resolve_in(&ws, &rel)?, &text, format, expected).map_err(|e| describe(&e, &rel, "save"))).await?
}

/// Each path's `{ mtime, size }`, for noticing changes made outside the editor; `{ missing: true }`,
/// or `{ error }` when the file exists but cannot be checked.
#[tauri::command]
pub async fn doc_stat(state: State<'_, AppState>, paths: Vec<String>) -> R<Vec<Value>> {
    let ws = workspace(&state)?;
    blocking(move || {
        paths
            .iter()
            .map(|rel| match resolve_in(&ws, rel) {
                Ok(path) => stat(&path).unwrap_or_else(|e| json!({ "error": describe(&e, rel, "check") })),
                Err(e) => json!({ "error": e }),
            })
            .collect()
    })
    .await
}

fn stat(path: &Path) -> io::Result<Value> {
    match fs::metadata(path) {
        Ok(meta) => Ok(json!(Stamp::of(&meta))),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(json!({ "missing": true })),
        Err(e) => Err(e),
    }
}

fn save_document(path: &Path, text: &str, format: Format, expected: Option<Stamp>) -> io::Result<Value> {
    if let Some(expected) = expected {
        match fs::metadata(path) {
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(json!({ "status": "deleted" })),
            Err(e) => return Err(e),
            Ok(meta) if Stamp::of(&meta).differs(&expected) => return Ok(json!({ "status": "changed" })),
            Ok(_) => {}
        }
    }
    write_atomically(path, &encode(text, format))?;
    let Stamp { mtime, size } = Stamp::of(&fs::metadata(path)?);
    Ok(json!({ "status": "saved", "mtime": mtime, "size": size }))
}

fn read_document(path: &Path) -> io::Result<Value> {
    let meta = match fs::metadata(path) {
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(json!({ "kind": "missing" })),
        result => result?,
    };
    let stamp = Stamp::of(&meta);
    let limit = text_limit(path);
    if stamp.size > limit {
        // Only the start is read, so a multi-gigabyte file costs no more than a small one.
        let mut start = Vec::new();
        File::open(path)?.take(BINARY_PROBE_BYTES).read_to_end(&mut start)?;
        let kind = if looks_binary(&start) { "binary" } else { "tooLarge" };
        return Ok(json!({ "kind": kind, "size": stamp.size, "limit": limit, "mtime": stamp.mtime }));
    }
    Ok(classify(fs::read(path)?, stamp.mtime))
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(BINARY_PROBE_BYTES as usize).any(|b| *b == 0)
}

fn classify(mut bytes: Vec<u8>, mtime: f64) -> Value {
    let size = bytes.len();
    if looks_binary(&bytes) {
        return json!({ "kind": "binary", "size": size, "mtime": mtime });
    }
    let bom = bytes.starts_with(BOM);
    if bom {
        bytes.drain(..BOM.len());
    }
    // Text that is not UTF-8 would be changed by saving it, so it is not opened at all.
    match String::from_utf8(bytes) {
        Err(_) => json!({ "kind": "notText", "size": size, "mtime": mtime }),
        Ok(text) => {
            let format = Format { line_ending: detect_line_ending(&text), bom };
            json!({ "kind": "text", "text": text, "mtime": mtime, "size": size, "format": format })
        }
    }
}

/// The line ending most lines use (`\n` on a tie, or with no line breaks at all).
fn detect_line_ending(text: &str) -> LineEnding {
    let crlf = text.matches("\r\n").count();
    let cr = text.matches('\r').count() - crlf;
    let lf = text.matches('\n').count() - crlf;
    if crlf > lf && crlf >= cr {
        LineEnding::Crlf
    } else if cr > lf && cr > crlf {
        LineEnding::Cr
    } else {
        LineEnding::Lf
    }
}

/// The bytes to write: the text exactly as given (the editor has put each line's ending back),
/// after the byte-order mark if the file had one.
fn encode(text: &str, format: Format) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() + BOM.len());
    if format.bom {
        out.extend_from_slice(BOM);
    }
    out.extend_from_slice(text.as_bytes());
    out
}

/// Writes beside the file and renames over it, so a full disk or a crash halfway through leaves
/// the old contents intact rather than a truncated file.
fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    // Through a symlink, the file it points to is the one to replace (in_workspace has already
    // checked that it is inside the folder).
    let target = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let existing = fs::metadata(&target).ok();
    if existing.as_ref().is_some_and(|m| m.permissions().readonly()) {
        return Err(ErrorKind::PermissionDenied.into());
    }
    let dir = target.parent().ok_or(ErrorKind::InvalidInput)?;
    let name = target.file_name().ok_or(ErrorKind::InvalidInput)?.to_string_lossy().into_owned();
    // A file saved again after it was deleted may have lost its folder too.
    fs::create_dir_all(dir)?;
    remove_stale_temps(dir, &name);
    let (temp, mut file) = create_temp(dir, &name)?;
    let result = (|| {
        file.write_all(bytes)?;
        // Through the open handle, so nothing else that appears at the temporary path is touched.
        if let Some(meta) = &existing {
            file.set_permissions(meta.permissions())?;
        }
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, &target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

/// Creates a new temporary file beside `name` under a name nobody can predict. It never opens an
/// entry that already exists, so a link planted in a cloned repository cannot redirect the save.
fn create_temp(dir: &Path, name: &str) -> io::Result<(PathBuf, File)> {
    for _ in 0..16 {
        let temp = dir.join(format!(".{name}{TEMP_MARK}-{}", uuid::Uuid::new_v4().simple()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::custom_flags(&mut options, libc::O_NOFOLLOW);
        match options.open(&temp) {
            Ok(file) => return Ok((temp, file)),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(ErrorKind::AlreadyExists.into())
}

/// Removes temporary files an earlier, interrupted save of `name` left behind. Only plain files
/// old enough not to belong to a save in progress; links and folders are never touched.
fn remove_stale_temps(dir: &Path, name: &str) {
    let prefix = format!(".{name}{TEMP_MARK}");
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if !entry.file_name().to_string_lossy().starts_with(&prefix) {
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(entry.path()) else { continue };
        let stale = meta.modified().ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > STALE_TEMP_AGE);
        if meta.file_type().is_file() && stale {
            let _ = fs::remove_file(entry.path());
        }
    }
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

    fn stamp_of(path: &Path) -> Stamp {
        serde_json::from_value(stat(path).unwrap()).unwrap()
    }

    #[test]
    fn line_endings_follow_most_lines() {
        assert_eq!(detect_line_ending("a\nb\n"), LineEnding::Lf);
        assert_eq!(detect_line_ending("a\r\nb\r\n"), LineEnding::Crlf);
        assert_eq!(detect_line_ending("a\r\nb\r\nc\n"), LineEnding::Crlf);
        assert_eq!(detect_line_ending("a\r\nb\nc\n"), LineEnding::Lf);
        assert_eq!(detect_line_ending("a\rb\rc\n"), LineEnding::Cr);
        assert_eq!(detect_line_ending("no break"), LineEnding::Lf);
    }

    #[test]
    fn saving_writes_the_text_as_given_and_keeps_the_bom() {
        assert_eq!(encode("a\r\nb\nc\rd", LF), b"a\r\nb\nc\rd");
        assert_eq!(encode("x\n", Format { line_ending: LineEnding::Lf, bom: true }), b"\xEF\xBB\xBFx\n");
    }

    #[test]
    fn reading_round_trips_through_saving() {
        for original in [&b"a\r\nb\r\n"[..], b"\xEF\xBB\xBFa\nb", b"one line", b"mixed\r\nends\nand\rlone\r\n"] {
            let read = classify(original.to_vec(), 0.0);
            let format: Format = serde_json::from_value(read["format"].clone()).unwrap();
            assert_eq!(encode(read["text"].as_str().unwrap(), format), original);
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
    fn notebooks_may_be_larger_than_other_text() {
        let dir = temp_dir("notebook-size");
        let notebook = dir.join("hw.IPYNB");
        fs::write(&notebook, "1".repeat(MAX_TEXT_BYTES as usize + 1)).unwrap();
        assert_eq!(read_document(&notebook).unwrap()["kind"], "text");
        fs::write(&notebook, "1".repeat(MAX_NOTEBOOK_BYTES as usize + 1)).unwrap();
        let read = read_document(&notebook).unwrap();
        assert_eq!(read["kind"], "tooLarge");
        assert_eq!(read["limit"], MAX_NOTEBOOK_BYTES);
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

    #[cfg(unix)]
    #[test]
    fn a_link_planted_at_the_temporary_name_is_not_followed() {
        let dir = temp_dir("planted");
        let outside = temp_dir("planted-outside");
        let victim = outside.join("victim.txt");
        fs::write(&victim, "precious\n").unwrap();
        let file = dir.join("a.py");
        fs::write(&file, "old\n").unwrap();
        // The name earlier versions used, and the stem of today's names.
        let planted = dir.join(".a.py.longhand-save");
        std::os::unix::fs::symlink(&victim, &planted).unwrap();

        save_document(&file, "new\n", LF, None).unwrap();
        assert_eq!(fs::read_to_string(&victim).unwrap(), "precious\n");
        assert_eq!(fs::read_to_string(&file).unwrap(), "new\n");
        assert!(fs::symlink_metadata(&file).unwrap().file_type().is_file());
        assert!(fs::symlink_metadata(&planted).unwrap().file_type().is_symlink(), "the link itself is left alone");
        fs::remove_dir_all(dir).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn temporary_names_are_new_each_time_and_never_reuse_an_entry() {
        let dir = temp_dir("temps");
        let (first, _) = create_temp(&dir, "a.py").unwrap();
        let (second, _) = create_temp(&dir, "a.py").unwrap();
        assert_ne!(first, second);
        assert!(first.file_name().unwrap().to_string_lossy().starts_with(".a.py.longhand-save-"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_save_removes_temporary_files_left_by_a_crash_but_not_recent_ones() {
        let dir = temp_dir("stale");
        let file = dir.join("a.py");
        fs::write(&file, "old\n").unwrap();
        let stale = dir.join(".a.py.longhand-save-0123");
        let recent = dir.join(".a.py.longhand-save-4567");
        let other = dir.join(".b.py.longhand-save-89ab");
        for path in [&stale, &recent, &other] {
            fs::write(path, "half").unwrap();
        }
        let old = std::time::SystemTime::now() - Duration::from_secs(3600);
        for path in [&stale, &other] {
            File::options().write(true).open(path).unwrap().set_modified(old).unwrap();
        }
        write_atomically(&file, b"new\n").unwrap();
        assert!(!stale.exists());
        assert!(recent.exists(), "it may belong to a save still in progress");
        assert!(other.exists(), "another file's are left for that file's next save");
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
        let read_at = stamp_of(&file);
        let earlier = Stamp { mtime: read_at.mtime - 5000.0, ..read_at };
        assert_eq!(save_document(&file, "mine\n", LF, Some(earlier)).unwrap()["status"], "changed");
        assert_eq!(fs::read_to_string(&file).unwrap(), "theirs\n");

        let saved = save_document(&file, "mine\n", LF, Some(read_at)).unwrap();
        assert_eq!(saved["status"], "saved");
        assert_eq!(stat(&file).unwrap(), json!({ "mtime": saved["mtime"], "size": 5 }));
        assert_eq!(fs::read_to_string(&file).unwrap(), "mine\n");

        fs::remove_file(&file).unwrap();
        assert_eq!(stat(&file).unwrap(), json!({ "missing": true }));
        assert_eq!(save_document(&file, "mine\n", LF, Some(read_at)).unwrap()["status"], "deleted");
        // Without an expected version the save goes ahead: the student chose to write it back.
        assert_eq!(save_document(&file, "mine\n", LF, None).unwrap()["status"], "saved");
        assert_eq!(fs::read_to_string(&file).unwrap(), "mine\n");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_change_within_the_same_second_is_caught_by_the_size() {
        let dir = temp_dir("coarse");
        let file = dir.join("a.py");
        fs::write(&file, "x=1\n").unwrap();
        let read_at = stamp_of(&file);
        // A formatter rewrites the file, and the file system keeps the same (whole-second) time.
        fs::write(&file, "x = 1\n").unwrap();
        File::options()
            .write(true)
            .open(&file)
            .unwrap()
            .set_modified(std::time::UNIX_EPOCH + Duration::from_millis(read_at.mtime as u64))
            .unwrap();
        assert_eq!(stamp_of(&file).mtime, read_at.mtime);
        assert_eq!(save_document(&file, "mine\n", LF, Some(read_at)).unwrap()["status"], "changed");
        assert_eq!(fs::read_to_string(&file).unwrap(), "x = 1\n");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn stamps_within_a_millisecond_and_of_the_same_size_are_the_same() {
        let at = |mtime, size| Stamp { mtime, size };
        assert!(!at(1000.0, 5).differs(&at(1000.6, 5)));
        assert!(at(1002.0, 5).differs(&at(1000.0, 5)));
        assert!(at(900.0, 5).differs(&at(1000.0, 5)));
        assert!(at(1000.0, 5).differs(&at(1000.0, 6)));
    }
}
