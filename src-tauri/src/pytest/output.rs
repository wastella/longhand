//! Reading a run's output as it arrives: pytest's terminal text, and the reporter's record file.

use std::fs::File;
use std::io::Read;
use std::path::PathBuf;

/// Decodes UTF-8 that arrives in arbitrary chunks. A character split across two chunks is kept
/// whole, and bytes that are not UTF-8 at all become U+FFFD instead of failing.
#[derive(Default)]
pub struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let keep = incomplete_tail(&self.pending);
        let ready: Vec<u8> = self.pending.drain(..self.pending.len() - keep).collect();
        String::from_utf8_lossy(&ready).into_owned()
    }

    /// Whatever is left at the end, even if it is a cut-off character.
    pub fn finish(&mut self) -> String {
        String::from_utf8_lossy(&std::mem::take(&mut self.pending)).into_owned()
    }
}

/// How many bytes at the end could be the start of a character still to come.
fn incomplete_tail(bytes: &[u8]) -> usize {
    for back in 1..=bytes.len().min(3) {
        let byte = bytes[bytes.len() - back];
        if byte & 0b1100_0000 == 0b1000_0000 {
            continue; // a continuation byte; look further back for the lead
        }
        let needed = match byte {
            0b1100_0000..=0b1101_1111 => 2,
            0b1110_0000..=0b1110_1111 => 3,
            0b1111_0000..=0b1111_0111 => 4,
            _ => return 0,
        };
        return if needed > back { back } else { 0 };
    }
    0
}

/// The last `limit` bytes of a long text, so a run that prints without end cannot fill memory.
pub struct Tail {
    text: String,
    limit: usize,
    dropped: bool,
}

impl Tail {
    pub fn new(limit: usize) -> Self {
        Tail { text: String::new(), limit, dropped: false }
    }

    pub fn push(&mut self, more: &str) {
        self.text.push_str(more);
        if self.text.len() > self.limit * 2 {
            let mut cut = self.text.len() - self.limit;
            while !self.text.is_char_boundary(cut) {
                cut += 1;
            }
            self.text.drain(..cut);
            self.dropped = true;
        }
    }

    pub fn into_string(self) -> String {
        if self.dropped {
            format!("… the start of the output was too long to keep …\n{}", self.text)
        } else {
            self.text
        }
    }
}

/// Reads complete lines from a file another process is still writing.
pub struct LineReader {
    path: PathBuf,
    file: Option<File>,
    partial: Vec<u8>,
}

impl LineReader {
    pub fn new(path: PathBuf) -> Self {
        LineReader { path, file: None, partial: vec![] }
    }

    /// The lines finished since the last call. The file may not exist yet.
    pub fn read_lines(&mut self) -> Vec<String> {
        if self.file.is_none() {
            self.file = File::open(&self.path).ok();
        }
        let Some(file) = &mut self.file else { return vec![] };
        let _ = file.read_to_end(&mut self.partial);
        let Some(end) = self.partial.iter().rposition(|&b| b == b'\n') else { return vec![] };
        let complete: Vec<u8> = self.partial.drain(..=end).collect();
        String::from_utf8_lossy(&complete).lines().map(str::to_string).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_characters_split_across_chunks() {
        let mut stream = Utf8Stream::default();
        let bytes = "naïve → ok".as_bytes();
        let mut out = String::new();
        for chunk in bytes.chunks(1) {
            out += &stream.push(chunk);
        }
        out += &stream.finish();
        assert_eq!(out, "naïve → ok");
    }

    #[test]
    fn replaces_bytes_that_are_not_utf8() {
        let raw = include_bytes!("fixtures/non-utf8.out");
        let mut stream = Utf8Stream::default();
        let mut out = String::new();
        for chunk in raw.chunks(7) {
            out += &stream.push(chunk);
        }
        out += &stream.finish();
        assert!(out.contains("bytes: \u{fffd}\u{fffd} ok"));
        assert!(out.contains("1 failed, 22 deselected"));
        let mut cut = Utf8Stream::default();
        assert_eq!(cut.push(&[b'a', 0xe2, 0x86]), "a");
        assert_eq!(cut.finish(), "\u{fffd}");
    }

    #[test]
    fn tail_keeps_the_end() {
        let mut tail = Tail::new(10);
        tail.push("0123456789");
        tail.push("abcdefghijé");
        let text = tail.into_string();
        assert!(text.starts_with("… the start"));
        assert!(text.ends_with("\ncdefghijé"));
        let mut short = Tail::new(10);
        short.push("hi");
        assert_eq!(short.into_string(), "hi");
    }

    #[test]
    fn reads_only_finished_lines() {
        use std::io::Write;
        let path = std::env::temp_dir().join(format!("longhand-lines-{}.jsonl", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut reader = LineReader::new(path.clone());
        assert!(reader.read_lines().is_empty(), "no file yet");
        let mut file = File::create(&path).unwrap();
        write!(file, "one\ntw").unwrap();
        assert_eq!(reader.read_lines(), ["one"]);
        writeln!(file, "o").unwrap();
        assert_eq!(reader.read_lines(), ["two"]);
        std::fs::remove_file(&path).unwrap();
    }
}
