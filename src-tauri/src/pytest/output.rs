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
#[derive(Clone)]
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

/// Output on its way to the interface while a run goes, and the end of it kept for afterwards.
/// The reader thread adds to it; the run's loop sends what is new a few times a second, so a
/// test printing without end cannot flood the interface.
pub struct Captured {
    tail: Tail,
    fresh: String,
    skipped: usize,
    batch: usize,
}

impl Captured {
    pub fn new(keep: usize, batch: usize) -> Self {
        Captured { tail: Tail::new(keep), fresh: String::new(), skipped: 0, batch }
    }

    pub fn push(&mut self, text: &str) {
        self.tail.push(text);
        self.fresh.push_str(text);
        if self.fresh.len() > self.batch * 2 {
            let mut cut = self.fresh.len() - self.batch;
            while !self.fresh.is_char_boundary(cut) {
                cut += 1;
            }
            self.fresh.drain(..cut);
            self.skipped += cut;
        }
    }

    /// What arrived since the last call, at most about one batch of it.
    pub fn take_fresh(&mut self) -> String {
        let text = std::mem::take(&mut self.fresh);
        match std::mem::take(&mut self.skipped) {
            0 => text,
            skipped => format!("\n… {skipped} characters of output not shown here; Output has the end of it after the run …\n{text}"),
        }
    }

    pub fn output(&self) -> String {
        self.tail.clone().into_string()
    }
}

/// The most read from the record file at once, and the longest record kept. The reporter caps
/// what it writes well below this; the limits keep a broken one from filling memory.
const READ_LIMIT: u64 = 8 << 20;
const LINE_LIMIT: usize = 32 << 20;

/// Reads complete lines from a file another process is still writing.
pub struct LineReader {
    path: PathBuf,
    file: Option<File>,
    partial: Vec<u8>,
    /// The current line grew past the limit; it is dropped up to its end.
    skipping: bool,
    /// The last read stopped at the limit, so there may be more to read straight away.
    pub more: bool,
    read_limit: u64,
    line_limit: usize,
}

impl LineReader {
    pub fn new(path: PathBuf) -> Self {
        Self::with_limits(path, READ_LIMIT, LINE_LIMIT)
    }

    fn with_limits(path: PathBuf, read_limit: u64, line_limit: usize) -> Self {
        LineReader { path, file: None, partial: vec![], skipping: false, more: false, read_limit, line_limit }
    }

    /// The lines finished since the last call. The file may not exist yet.
    pub fn read_lines(&mut self) -> Vec<String> {
        if self.file.is_none() {
            self.file = File::open(&self.path).ok();
        }
        let Some(file) = &mut self.file else { return vec![] };
        let mut chunk = vec![];
        let _ = Read::take(&mut *file, self.read_limit).read_to_end(&mut chunk);
        self.more = chunk.len() as u64 == self.read_limit;
        let mut lines = vec![];
        let mut rest = &chunk[..];
        while let Some(end) = rest.iter().position(|&b| b == b'\n') {
            if !self.skipping {
                self.partial.extend_from_slice(&rest[..end]);
                lines.push(String::from_utf8_lossy(&self.partial).into_owned());
            }
            self.partial.clear();
            self.skipping = false;
            rest = &rest[end + 1..];
        }
        if !self.skipping {
            self.partial.extend_from_slice(rest);
            if self.partial.len() > self.line_limit {
                self.partial = vec![];
                self.skipping = true;
            }
        }
        lines
    }

    /// Everything left to read now.
    pub fn read_all(&mut self) -> Vec<String> {
        let mut lines = self.read_lines();
        while self.more {
            lines.extend(self.read_lines());
        }
        lines
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

    #[test]
    fn reads_in_bounded_pieces_and_drops_overlong_lines() {
        use std::io::Write;
        let path = std::env::temp_dir().join(format!("longhand-bounded-{}.jsonl", std::process::id()));
        let mut file = File::create(&path).unwrap();
        writeln!(file, "short\n{}\nafter", "x".repeat(100)).unwrap();
        let mut reader = LineReader::with_limits(path.clone(), 16, 40);
        assert_eq!(reader.read_lines(), ["short"]);
        assert!(reader.more);
        assert_eq!(reader.read_all(), ["after"], "the 100-byte line is dropped, the next is kept");
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn captured_output_is_sent_in_bounded_batches() {
        let mut captured = Captured::new(1000, 10);
        captured.push("hello ");
        assert_eq!(captured.take_fresh(), "hello ");
        assert_eq!(captured.take_fresh(), "");
        captured.push(&"y".repeat(50));
        let sent = captured.take_fresh();
        assert!(sent.contains("40 characters of output not shown") && sent.ends_with(&"y".repeat(10)), "{sent}");
        assert_eq!(captured.output(), format!("hello {}", "y".repeat(50)));
    }
}
