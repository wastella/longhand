//! The bytes of the files the viewer shows (PDFs and pictures), inside the open folder. They go
//! to the interface as raw bytes, not JSON. A file too large to show, or something that is not a
//! regular file (a pipe would never finish reading), is refused with a reason the interface
//! turns into a sentence.

use crate::files::resolve_in;
use crate::workspace::{workspace, AppState};
use serde_json::{json, Value};
use std::fs;
use std::io::{self, ErrorKind, Read};
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use tauri::ipc::Response;
use tauri::State;

/// The largest PDF shown. Course handouts are a few megabytes; scanned books can be hundreds.
const MAX_PDF_BYTES: u64 = 200 * 1024 * 1024;
/// The largest picture shown, which the interface turns into a data: URL.
const MAX_IMAGE_BYTES: u64 = 40 * 1024 * 1024;

/// How large a file the viewer reads for `path`, by its extension; None for anything it does not show.
fn limit_for(path: &Path) -> Option<u64> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "pdf" => Some(MAX_PDF_BYTES),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" => Some(MAX_IMAGE_BYTES),
        _ => None,
    }
}

/// Why a file was not read: `{ code, message, size? }`, with code `missing`, `tooLarge`,
/// `notFile` or `failed`.
fn problem(code: &str, message: impl Into<String>) -> Value {
    json!({ "code": code, "message": message.into() })
}

fn too_large(size: u64) -> Value {
    let mut out = problem("tooLarge", "This file is too large to show.");
    out["size"] = json!(size);
    out
}

/// Reads the file at `path`, checking what it is on the open handle itself, so nothing swapped
/// in after the check (a pipe, a larger file) is read instead.
fn read_viewable(path: &Path) -> Result<Vec<u8>, Value> {
    let limit = limit_for(path).ok_or_else(|| problem("failed", "Longhand does not show this kind of file."))?;
    // Non-blocking, so opening a pipe returns at once instead of waiting for a writer.
    let file = fs::OpenOptions::new().read(true).custom_flags(libc::O_NONBLOCK).open(path).map_err(|e| from_io(&e))?;
    let meta = file.metadata().map_err(|e| from_io(&e))?;
    if !meta.is_file() {
        return Err(problem("notFile", "This is not a regular file."));
    }
    if meta.len() > limit {
        return Err(too_large(meta.len()));
    }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    // One byte past the limit tells a file that grew since the check.
    file.take(limit + 1).read_to_end(&mut bytes).map_err(|e| from_io(&e))?;
    if bytes.len() as u64 > limit {
        return Err(too_large(bytes.len() as u64));
    }
    Ok(bytes)
}

/// The bytes of the viewable file `rel` inside the folder `ws`.
fn read_in(ws: &Path, rel: &str) -> Result<Vec<u8>, Value> {
    let path = resolve_in(ws, rel).map_err(|e| problem("failed", e))?;
    read_viewable(&path)
}

fn from_io(e: &io::Error) -> Value {
    match e.kind() {
        ErrorKind::NotFound => problem("missing", "This file no longer exists."),
        ErrorKind::PermissionDenied => problem("failed", "You don't have permission to read this file."),
        _ => problem("failed", format!("The file could not be read: {e}")),
    }
}

/// The bytes of a PDF or picture at `rel` in the open folder.
#[tauri::command]
pub async fn view_read(state: State<'_, AppState>, rel: String) -> Result<Response, Value> {
    let ws = workspace(&state).map_err(|e| problem("failed", e))?;
    tauri::async_runtime::spawn_blocking(move || read_in(&ws, &rel).map(Response::new))
        .await
        .map_err(|e| problem("failed", e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::tests::temp_dir;

    #[test]
    fn only_pdfs_and_pictures_have_a_limit() {
        assert_eq!(limit_for(Path::new("handout.PDF")), Some(MAX_PDF_BYTES));
        for name in ["a.png", "b.jpg", "c.JPEG", "d.gif", "e.webp", "f.svg"] {
            assert_eq!(limit_for(Path::new(name)), Some(MAX_IMAGE_BYTES), "{name}");
        }
        for name in ["model.py", "notes.md", "pdf", "archive.pdf.zip"] {
            assert_eq!(limit_for(Path::new(name)), None, "{name}");
        }
    }

    #[test]
    fn a_pdf_is_read_as_its_bytes() {
        let dir = temp_dir("read");
        fs::write(dir.join("h.pdf"), b"%PDF-1.4 \x00\xff").unwrap();
        assert_eq!(read_viewable(&dir.join("h.pdf")).unwrap(), b"%PDF-1.4 \x00\xff");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn missing_unknown_and_oversized_files_are_refused_with_a_reason() {
        let dir = temp_dir("refuse");
        assert_eq!(read_viewable(&dir.join("gone.pdf")).unwrap_err()["code"], "missing");
        fs::write(dir.join("code.py"), "x = 1").unwrap();
        assert_eq!(read_viewable(&dir.join("code.py")).unwrap_err()["code"], "failed");
        // A sparse file: large on paper, nothing written.
        let big = fs::File::create(dir.join("big.png")).unwrap();
        big.set_len(MAX_IMAGE_BYTES + 1).unwrap();
        let refused = read_viewable(&dir.join("big.png")).unwrap_err();
        assert_eq!(refused["code"], "tooLarge");
        assert_eq!(refused["size"], MAX_IMAGE_BYTES + 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_pipe_is_refused_rather_than_read_forever() {
        let dir = temp_dir("pipe");
        let pipe = dir.join("stream.pdf");
        let name = std::ffi::CString::new(pipe.to_string_lossy().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
        assert_eq!(read_viewable(&pipe).unwrap_err()["code"], "notFile");
        assert_eq!(read_viewable(&dir.join("folder.pdf")).unwrap_err()["code"], "missing");
        fs::create_dir(dir.join("folder.pdf")).unwrap();
        assert_eq!(read_viewable(&dir.join("folder.pdf")).unwrap_err()["code"], "notFile");
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn only_files_inside_the_folder_are_read() {
        let root = temp_dir("view-inside");
        let ws = root.join("course");
        fs::create_dir_all(ws.join("docs")).unwrap();
        fs::write(ws.join("docs/h.pdf"), b"%PDF").unwrap();
        fs::write(root.join("secret.png"), b"not yours").unwrap();
        std::os::unix::fs::symlink(root.join("secret.png"), ws.join("link.png")).unwrap();
        std::os::unix::fs::symlink(&root, ws.join("up")).unwrap();
        assert_eq!(read_in(&ws, "docs/h.pdf").unwrap(), b"%PDF");
        assert_eq!(read_in(&ws, "./docs/h.pdf").unwrap(), b"%PDF");
        for rel in ["../secret.png", "docs/../../secret.png", "/etc/hosts.png", "link.png", "up/secret.png"] {
            assert_eq!(read_in(&ws, rel).unwrap_err()["code"], "failed", "{rel}");
        }
        fs::remove_dir_all(root).unwrap();
    }
}
