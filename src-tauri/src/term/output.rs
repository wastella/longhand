//! Carries a pseudo-terminal's output to the interface without letting heavy output swamp it.
//!
//! Three threads per terminal: a reader that copies bytes off the pseudo-terminal, a waiter that
//! notices the shell exit, and a pump that decodes the bytes as UTF-8, coalesces them into
//! batches and hands each batch to a sink. The reader sends through a bounded channel and the
//! pump waits while too much output is unacknowledged, so a program printing faster than the
//! interface can draw ends up blocked on its own writes, as it would in any terminal.

use portable_pty::Child;
use std::io::Read;
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

/// Bytes per read from the pseudo-terminal.
const READ_SIZE: usize = 16 * 1024;
/// Reads that may queue up before the reader waits for the pump.
const QUEUED_READS: usize = 16;
/// A batch is sent once it holds this much, or once it has waited `BATCH_WINDOW`.
const BATCH_BYTES: usize = 64 * 1024;
const BATCH_WINDOW: Duration = Duration::from_millis(4);
/// Output sent but not yet drawn, beyond which the pump waits for the interface.
pub const MAX_UNACKED: usize = 512 * 1024;
/// How long the pump waits for an acknowledgement before assuming it was lost.
const ACK_TIMEOUT: Duration = Duration::from_secs(2);
/// After the shell exits, output still arriving within this long belongs to it.
const EXIT_DRAIN: Duration = Duration::from_millis(150);

/// What the pump hands to its sink.
#[derive(Debug, PartialEq)]
pub enum Output {
    /// Decoded text, and how many bytes of output it came from (the unit acknowledgements use).
    Data { text: String, bytes: usize },
    /// The shell exited, with its exit code when it has one. Always the last output.
    Exit { code: Option<u32> },
}

/// Counts output the interface has been sent but not yet drawn.
#[derive(Default)]
pub struct Flow {
    unacked: Mutex<usize>,
    room: Condvar,
}

impl Flow {
    /// The interface has drawn `bytes` more bytes of output.
    pub fn ack(&self, bytes: usize) {
        let mut unacked = self.unacked.lock().unwrap();
        *unacked = unacked.saturating_sub(bytes);
        self.room.notify_all();
    }

    pub(crate) fn sent(&self, bytes: usize) {
        *self.unacked.lock().unwrap() += bytes;
    }

    /// Blocks while too much output is waiting to be drawn. A lost acknowledgement (the page
    /// reloaded, say) must not freeze the terminal for good, so a long wait forgives the debt.
    pub(crate) fn wait_for_room(&self) {
        let unacked = self.unacked.lock().unwrap();
        let (mut unacked, wait) = self.room.wait_timeout_while(unacked, ACK_TIMEOUT, |n| *n > MAX_UNACKED).unwrap();
        if wait.timed_out() {
            *unacked = 0;
        }
    }
}

/// Decodes a byte stream as UTF-8, holding back a character split across two reads until the
/// rest of it arrives. Invalid bytes become U+FFFD.
#[derive(Default)]
pub struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut out = String::with_capacity(self.pending.len());
        let mut at = 0;
        while at < self.pending.len() {
            match std::str::from_utf8(&self.pending[at..]) {
                Ok(text) => {
                    out.push_str(text);
                    at = self.pending.len();
                }
                Err(e) => {
                    let valid = at + e.valid_up_to();
                    out.push_str(std::str::from_utf8(&self.pending[at..valid]).unwrap());
                    match e.error_len() {
                        Some(bad) => {
                            out.push(char::REPLACEMENT_CHARACTER);
                            at = valid + bad;
                        }
                        // An incomplete character at the end: keep it for the next push.
                        None => {
                            at = valid;
                            break;
                        }
                    }
                }
            }
        }
        self.pending.drain(..at);
        out
    }

    /// Whatever is left when the stream ends: an incomplete character that will never finish.
    pub fn finish(&mut self) -> String {
        let rest = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        rest
    }
}

enum Event {
    Data(Vec<u8>),
    /// The pseudo-terminal reported end of file or an error: no more output.
    Closed,
    Exited(Option<u32>),
}

/// Starts the reader, waiter and pump threads for one terminal.
pub fn start(
    mut reader: Box<dyn Read + Send>,
    mut child: Box<dyn Child + Send + Sync>,
    flow: Arc<Flow>,
    sink: impl FnMut(Output) + Send + 'static,
) {
    let (tx, rx) = sync_channel(QUEUED_READS);
    let exit_tx = tx.clone();
    std::thread::spawn(move || {
        let mut buf = vec![0u8; READ_SIZE];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.send(Event::Data(buf[..n].to_vec())).is_err() {
                        return;
                    }
                }
            }
        }
        let _ = tx.send(Event::Closed);
    });
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|status| status.exit_code());
        let _ = exit_tx.send(Event::Exited(code));
    });
    std::thread::spawn(move || pump(rx, &flow, sink));
}

fn pump(rx: Receiver<Event>, flow: &Flow, mut sink: impl FnMut(Output)) {
    let mut decoder = Utf8Stream::default();
    let mut closed = false;
    let mut exited: Option<Option<u32>> = None;
    let send = |text: String, bytes: usize, sink: &mut dyn FnMut(Output)| {
        if !text.is_empty() {
            flow.sent(bytes);
            sink(Output::Data { text, bytes });
        }
    };
    while !(closed && exited.is_some()) {
        // Once the shell has exited, a background job may hold the terminal open, so stop
        // waiting for end of file after a moment of quiet.
        let event = match exited {
            None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
            Some(_) => rx.recv_timeout(EXIT_DRAIN),
        };
        let mut batch = match event {
            Ok(Event::Data(bytes)) => bytes,
            Ok(Event::Closed) => {
                closed = true;
                continue;
            }
            Ok(Event::Exited(code)) => {
                exited = Some(code);
                continue;
            }
            Err(_) => break,
        };
        let deadline = Instant::now() + BATCH_WINDOW;
        while batch.len() < BATCH_BYTES {
            match rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                Ok(Event::Data(bytes)) => batch.extend_from_slice(&bytes),
                Ok(Event::Closed) => closed = true,
                Ok(Event::Exited(code)) => exited = Some(code),
                Err(_) => break,
            }
            if closed {
                break;
            }
        }
        flow.wait_for_room();
        send(decoder.push(&batch), batch.len(), &mut sink);
    }
    let tail = decoder.finish();
    let tail_len = tail.len();
    send(tail, tail_len, &mut sink);
    sink(Output::Exit { code: exited.flatten() });
}

#[cfg(test)]
mod tests {
    use super::*;
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::sync::mpsc::channel;

    #[test]
    fn utf8_stream_holds_back_a_character_split_across_reads() {
        let mut stream = Utf8Stream::default();
        let text = "é世🙂";
        let bytes = text.as_bytes();
        let mut out = String::new();
        // Feed one byte at a time: every multi-byte character is split.
        for b in bytes {
            out.push_str(&stream.push(std::slice::from_ref(b)));
        }
        assert_eq!(out, text);
        assert_eq!(stream.finish(), "");
    }

    #[test]
    fn utf8_stream_replaces_invalid_bytes_and_keeps_going() {
        let mut stream = Utf8Stream::default();
        assert_eq!(stream.push(b"a\xffb\xe4\xb8"), "a\u{FFFD}b");
        assert_eq!(stream.push(b"\x96c"), "世c");
        assert_eq!(stream.push(b"\xf0\x9f"), "");
        assert_eq!(stream.finish(), "\u{FFFD}");
    }

    #[test]
    fn flow_waits_for_acknowledgement_then_resumes() {
        let flow = Arc::new(Flow::default());
        flow.sent(MAX_UNACKED + 1);
        let waiter = {
            let flow = flow.clone();
            std::thread::spawn(move || {
                let start = Instant::now();
                flow.wait_for_room();
                start.elapsed()
            })
        };
        std::thread::sleep(Duration::from_millis(100));
        flow.ack(MAX_UNACKED);
        let waited = waiter.join().unwrap();
        assert!(waited >= Duration::from_millis(90) && waited < ACK_TIMEOUT, "waited {waited:?}");
    }

    struct Cat {
        rx: std::sync::mpsc::Receiver<Output>,
        flow: Arc<Flow>,
        _master: Box<dyn portable_pty::MasterPty + Send>,
    }

    /// Runs `cat` on a pseudo-terminal through the real reader and pump. Output processing is
    /// off, so the bytes arrive exactly as written (with it on, macOS sometimes doubles the
    /// carriage return it adds before a newline when its buffer fills, which no terminal shows).
    fn cat_through_pty(path: &std::path::Path) -> Cat {
        let pair = native_pty_system().openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.args(["-c", "stty -opost && exec cat \"$0\"", &path.to_string_lossy()]);
        let child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().unwrap();
        let flow = Arc::new(Flow::default());
        let (tx, rx) = channel();
        start(reader, child, flow.clone(), move |out| tx.send(out).unwrap());
        Cat { rx, flow, _master: pair.master }
    }

    impl Cat {
        /// Collects output, acknowledging it the way the interface does, until the exit.
        fn read_to_exit(&self, text: &mut String) -> Option<u32> {
            loop {
                match self.rx.recv_timeout(Duration::from_secs(30)).expect("output stalled") {
                    Output::Data { text: chunk, bytes } => {
                        text.push_str(&chunk);
                        self.flow.ack(bytes);
                    }
                    Output::Exit { code } => return code,
                }
            }
        }
    }

    fn sample_file(lines: usize) -> (std::path::PathBuf, String) {
        let dir = crate::workspace::tests::temp_dir("pty-volume");
        let body: String = (0..lines).map(|i| format!("step {i:06} loss=0.{i:04} 世界 é 🙂\n")).collect();
        let path = dir.join("log.txt");
        std::fs::write(&path, &body).unwrap();
        (path, body)
    }

    #[test]
    fn heavy_output_arrives_intact_and_in_order() {
        // About 7 MB, read 16 KB at a time, so many multi-byte characters straddle two reads.
        let (path, body) = sample_file(200_000);
        let cat = cat_through_pty(&path);
        let mut text = String::new();
        assert_eq!(cat.read_to_exit(&mut text), Some(0));
        assert_eq!(text.len(), body.len());
        assert!(text == body, "output differs from the file");
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn unacknowledged_output_holds_the_program_back() {
        let (path, body) = sample_file(60_000);
        let cat = cat_through_pty(&path);
        // Take output without acknowledging it until it stops coming.
        let mut text = String::new();
        while let Ok(Output::Data { text: chunk, .. }) = cat.rx.recv_timeout(Duration::from_millis(500)) {
            text.push_str(&chunk);
        }
        assert!(text.len() <= MAX_UNACKED + BATCH_BYTES + READ_SIZE, "sent {} bytes ahead", text.len());
        assert!(text.len() < body.len() / 2, "cat was held back");
        // Acknowledging lets the rest through, still intact.
        cat.flow.ack(text.len());
        assert_eq!(cat.read_to_exit(&mut text), Some(0));
        assert!(text == body, "output differs from the file");
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
