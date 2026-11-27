//! One running language server: its process group and the threads that carry messages to and
//! from it. Nothing here knows what the messages mean.
//!
//! Four threads per server. A writer takes framed messages from a queue and writes them to the
//! server's standard input, so sending never waits on a server that has stopped reading. A
//! reader decodes the server's standard output into messages and hands each to a sink, pausing
//! while the interface has too many still to handle, so a server that floods is held back by
//! its own pipe. A third keeps the tail of standard error for the exit report, and a fourth
//! watches for the process ending. Every buffer is bounded.

use super::framing::{self, Decoder, MAX_BODY};
use std::io::{Read, Write};
use std::os::unix::process::CommandExt;
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

/// Bytes per read from the server's output.
const READ_SIZE: usize = 64 * 1024;
/// Messages sent to the interface but not yet handled, beyond which the reader waits.
const MAX_UNACKED: usize = 4 * 1024 * 1024;
/// How long the reader waits for an acknowledgement before assuming it was lost.
const ACK_TIMEOUT: Duration = Duration::from_secs(5);
/// Messages waiting to be written to the server, beyond which it counts as hung.
const MAX_QUEUED: usize = 16 * 1024 * 1024;
/// How much of the end of the server's error output is kept.
const STDERR_TAIL: usize = 2048;
/// How long a server gets to exit after being asked before it is made to.
const STOP_GRACE: Duration = Duration::from_millis(1500);
/// After the server is gone, how long to wait for the rest of its output and error output.
const DRAIN: Duration = Duration::from_millis(300);
const POLL: Duration = Duration::from_millis(20);

/// What a server's reader hands to its sink.
#[derive(Debug, PartialEq)]
pub enum Event {
    /// One JSON-RPC message, without its headers.
    Message(String),
    /// The server ended by itself or had to be given up on. Always the last event. `stderr` is
    /// the end of what it wrote to standard error, then the reason if Longhand stopped it.
    Exit { code: Option<i32>, stderr: String },
}

/// Counts messages the interface has been sent but has not yet handled, in bytes.
#[derive(Default)]
struct Flow {
    unacked: Mutex<usize>,
    room: Condvar,
}

impl Flow {
    fn ack(&self, bytes: usize) {
        let mut unacked = self.unacked.lock().unwrap();
        *unacked = unacked.saturating_sub(bytes);
        self.room.notify_all();
    }

    fn sent(&self, bytes: usize) {
        *self.unacked.lock().unwrap() += bytes;
    }

    /// Blocks while too much is waiting to be handled. A lost acknowledgement (the page
    /// reloaded, say) must not stall the server for good, so a long wait forgives the debt.
    fn wait_for_room(&self) {
        let unacked = self.unacked.lock().unwrap();
        let (mut unacked, wait) = self.room.wait_timeout_while(unacked, ACK_TIMEOUT, |n| *n > MAX_UNACKED).unwrap();
        if wait.timed_out() {
            *unacked = 0;
        }
    }
}

/// What the threads and the handle share.
struct Shared {
    /// The server's process group, which is also the pid of the server itself.
    pgid: i32,
    flow: Flow,
    /// True once the server was stopped on purpose. The reader holds this lock while it hands
    /// an event to the sink, so after `stop` returns the sink is never called again.
    stopped: Mutex<bool>,
    /// Bytes waiting in the writer's queue.
    queued: AtomicUsize,
    /// Why Longhand gave up on the server, when it did.
    gave_up: Mutex<Option<String>>,
}

impl Shared {
    /// Ends the server because it can no longer be talked to. The reader then reports the exit.
    fn give_up(&self, reason: String) {
        self.gave_up.lock().unwrap().get_or_insert(reason);
        kill_group(self.pgid, libc::SIGKILL);
    }
}

/// A handle on a running server. Dropping it does not stop the server; `stop` does.
pub struct Server {
    shared: Arc<Shared>,
    outbox: Sender<Vec<u8>>,
}

impl Server {
    /// Queues one message for the server and returns at once. A server that has let
    /// `MAX_QUEUED` bytes pile up unread is hung, and is ended.
    pub fn send(&self, message: &str) {
        let frame = framing::encode(message);
        if self.shared.queued.fetch_add(frame.len(), Ordering::SeqCst) > MAX_QUEUED {
            return self.shared.give_up("Longhand stopped the language server because it stopped reading what it was sent.".into());
        }
        // The writer is gone only when the server is: its exit is reported by the reader.
        let _ = self.outbox.send(frame);
    }

    /// The interface has handled `bytes` more bytes of messages.
    pub fn ack(&self, bytes: usize) {
        self.shared.flow.ack(bytes);
    }

    /// Stops the server and everything it started, without waiting for them to go. The sink is
    /// not called again once this returns.
    pub fn stop(&self) {
        self.silence();
        let pgid = self.shared.pgid;
        kill_group(pgid, libc::SIGTERM);
        // Group ids are not reused while any member lives, and reuse by a new group within
        // the grace period is vanishingly unlikely.
        std::thread::spawn(move || {
            std::thread::sleep(STOP_GRACE);
            kill_group(pgid, libc::SIGKILL);
        });
    }

    fn silence(&self) {
        *self.shared.stopped.lock().unwrap() = true;
        // A reader waiting for the interface must not wait for one that has stopped listening.
        self.shared.flow.ack(usize::MAX);
    }
}

/// Stops these servers and returns only once they are gone, for when the app is quitting and
/// a thread left to finish the job would not get the chance.
pub fn stop_all_now(servers: &[Server]) {
    for server in servers {
        server.silence();
        kill_group(server.shared.pgid, libc::SIGTERM);
    }
    let deadline = Instant::now() + STOP_GRACE;
    while servers.iter().any(|server| group_alive(server.shared.pgid)) && Instant::now() < deadline {
        std::thread::sleep(POLL);
    }
    for server in servers {
        kill_group(server.shared.pgid, libc::SIGKILL);
    }
}

fn kill_group(pgid: i32, signal: i32) {
    unsafe { libc::kill(-pgid, signal) };
}

fn group_alive(pgid: i32) -> bool {
    unsafe { libc::kill(-pgid, 0) == 0 }
}

/// Starts `command` as a language server speaking over its standard input and output, in a
/// process group of its own so that whatever it starts (jdtls starts java, the TypeScript
/// server starts tsserver) can be stopped with it. `sink` gets each message in order, then one
/// `Exit` unless the server was stopped with `stop`.
pub fn spawn(mut command: Command, sink: impl FnMut(Event) + Send + 'static) -> std::io::Result<Server> {
    let mut child = command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).process_group(0).spawn()?;
    let pipes = (child.stdin.take(), child.stdout.take(), child.stderr.take());
    let (Some(stdin), Some(stdout), Some(stderr)) = pipes else { unreachable!("all three were asked for as pipes") };
    let shared = Arc::new(Shared {
        pgid: child.id() as i32,
        flow: Flow::default(),
        stopped: Mutex::new(false),
        queued: AtomicUsize::new(0),
        gave_up: Mutex::new(None),
    });
    let (outbox, inbox) = channel();
    let writing = shared.clone();
    std::thread::spawn(move || write(stdin, inbox, &writing));
    let (tail_tx, tail) = channel();
    std::thread::spawn(move || {
        let _ = tail_tx.send(read_tail(stderr));
    });
    let (exit_tx, exited) = channel();
    let watching = shared.clone();
    std::thread::spawn(move || {
        let _ = exit_tx.send(wait(child, &watching));
    });
    let reading = shared.clone();
    std::thread::spawn(move || read(stdout, &reading, exited, tail, sink));
    Ok(Server { shared, outbox })
}

/// The writer: ends when the server closes its input or every handle on the server is dropped.
fn write(mut stdin: ChildStdin, inbox: Receiver<Vec<u8>>, shared: &Shared) {
    for frame in inbox {
        let written = stdin.write_all(&frame).and_then(|()| stdin.flush());
        shared.queued.fetch_sub(frame.len(), Ordering::SeqCst);
        if written.is_err() {
            return;
        }
    }
}

/// One read that is not ended by a signal arriving: the bytes read, or 0 at the end of the
/// stream or on an error.
fn read_some(from: &mut impl Read, buf: &mut [u8]) -> usize {
    loop {
        match from.read(buf) {
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            read => return read.unwrap_or(0),
        }
    }
}

/// The end of everything written to `stderr`, read until it closes.
fn read_tail(mut stderr: ChildStderr) -> Vec<u8> {
    let mut tail = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        let n = read_some(&mut stderr, &mut buf);
        if n == 0 {
            break;
        }
        tail.extend_from_slice(&buf[..n]);
        let excess = tail.len().saturating_sub(STDERR_TAIL);
        tail.drain(..excess);
    }
    tail
}

/// The watcher: waits for the server itself to end, then ends whatever it left running, which
/// also closes the pipes the other threads are reading. Returns the exit code, if it has one.
fn wait(mut child: Child, shared: &Shared) -> Option<i32> {
    let code = child.wait().ok().and_then(|status| status.code());
    kill_group(shared.pgid, libc::SIGKILL);
    code
}

/// The reader: hands messages to the sink until the output ends or stops making sense, then
/// reports the exit.
fn read(mut stdout: ChildStdout, shared: &Shared, exited: Receiver<Option<i32>>, tail: Receiver<Vec<u8>>, mut sink: impl FnMut(Event)) {
    // False once the server was stopped on purpose: nothing more may be said about it.
    let mut deliver = |event: Event| {
        let stopped = shared.stopped.lock().unwrap();
        if !*stopped {
            sink(event);
        }
        !*stopped
    };
    let mut decoder = Decoder::new(MAX_BODY);
    let mut buf = vec![0u8; READ_SIZE];
    'stream: loop {
        let n = read_some(&mut stdout, &mut buf);
        if n == 0 {
            break;
        }
        decoder.push(&buf[..n]);
        loop {
            match decoder.pop() {
                Ok(Some(message)) => {
                    shared.flow.wait_for_room();
                    shared.flow.sent(message.len());
                    if !deliver(Event::Message(message)) {
                        break 'stream;
                    }
                }
                Ok(None) => break,
                Err(problem) => {
                    shared.give_up(format!("Longhand stopped the language server because {problem}."));
                    break 'stream;
                }
            }
        }
    }
    // A server that closed its output without exiting is of no further use.
    kill_group(shared.pgid, libc::SIGKILL);
    let code = exited.recv().unwrap_or(None);
    let mut stderr = String::from_utf8_lossy(&tail.recv_timeout(DRAIN).unwrap_or_default()).into_owned();
    if let Some(reason) = shared.gave_up.lock().unwrap().take() {
        if !stderr.is_empty() && !stderr.ends_with('\n') {
            stderr.push('\n');
        }
        stderr.push_str(&reason);
    }
    deliver(Event::Exit { code, stderr });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::RecvTimeoutError;

    const SOON: Duration = Duration::from_secs(10);

    /// Starts `/bin/sh -c script` as a server and returns it with the events it produces.
    fn serve(script: &str) -> (Server, Receiver<Event>) {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", script]);
        let (tx, rx) = channel();
        let server = spawn(command, move |event| {
            let _ = tx.send(event);
        })
        .unwrap();
        (server, rx)
    }

    fn exit_of(events: &Receiver<Event>) -> (Option<i32>, String) {
        loop {
            if let Event::Exit { code, stderr } = events.recv_timeout(SOON).expect("the server's exit is reported") {
                return (code, stderr);
            }
        }
    }

    fn wait_until_gone(pgid: i32) -> bool {
        let deadline = Instant::now() + SOON;
        while group_alive(pgid) && Instant::now() < deadline {
            std::thread::sleep(POLL);
        }
        !group_alive(pgid)
    }

    #[test]
    fn messages_are_framed_on_the_way_in_and_unframed_on_the_way_out_in_order() {
        // cat sends back exactly the bytes it was sent, so only correctly framed input decodes.
        let (server, events) = serve("exec cat");
        let sent: Vec<String> = (0..200).map(|i| format!("{{\"jsonrpc\":\"2.0\",\"id\":{i},\"note\":\"naïve ✓\"}}")).collect();
        for message in &sent {
            server.send(message);
        }
        for message in &sent {
            assert_eq!(events.recv_timeout(SOON).unwrap(), Event::Message(message.clone()));
            server.ack(message.len());
        }
        server.stop();
    }

    #[test]
    fn what_the_server_receives_is_the_content_length_frame() {
        let (server, events) = serve("head -c 23 >&2");
        server.send("{}");
        let (code, stderr) = exit_of(&events);
        assert_eq!((code, stderr.as_str()), (Some(0), "Content-Length: 2\r\n\r\n{}"));
    }

    #[test]
    fn a_large_message_makes_the_round_trip() {
        let (server, events) = serve("exec cat");
        let message = format!("{{\"text\":\"{}\"}}", "x".repeat(2 * 1024 * 1024));
        server.send(&message);
        assert_eq!(events.recv_timeout(SOON).unwrap(), Event::Message(message));
        server.stop();
    }

    #[test]
    fn a_server_that_exits_is_reported_with_its_code_and_the_end_of_its_errors() {
        let (_server, events) =
            serve("printf 'Content-Length: 2\\r\\n\\r\\n{}'; echo 'ModuleNotFoundError: no module named pylsp' >&2; exit 3");
        assert_eq!(events.recv_timeout(SOON).unwrap(), Event::Message("{}".into()));
        assert_eq!(
            events.recv_timeout(SOON).unwrap(),
            Event::Exit { code: Some(3), stderr: "ModuleNotFoundError: no module named pylsp\n".into() }
        );
        assert_eq!(events.recv_timeout(Duration::from_millis(200)), Err(RecvTimeoutError::Disconnected), "the exit is the last event");
    }

    #[test]
    fn only_the_end_of_a_long_error_output_is_kept() {
        let (_server, events) =
            serve("i=0; while [ $i -lt 500 ]; do echo \"warning number $i\" >&2; i=$((i+1)); done; echo 'fatal: the end' >&2; exit 1");
        let (code, stderr) = exit_of(&events);
        assert_eq!(code, Some(1));
        assert!(stderr.len() <= STDERR_TAIL, "{} bytes kept", stderr.len());
        assert!(stderr.ends_with("warning number 499\nfatal: the end\n"), "{stderr}");
    }

    #[test]
    fn a_server_killed_by_a_signal_has_no_exit_code() {
        let (_server, events) = serve("kill -KILL $$");
        assert_eq!(exit_of(&events), (None, String::new()));
    }

    #[test]
    fn output_that_is_not_the_protocol_ends_the_server_and_says_why() {
        let (server, events) = serve("printf 'Traceback (most recent call last)\\r\\n\\r\\n'; exec sleep 30");
        let (code, stderr) = exit_of(&events);
        assert_eq!(code, None, "it was killed rather than left running");
        assert_eq!(stderr, "Longhand stopped the language server because it sent a message with a malformed header.");
        assert!(wait_until_gone(server.shared.pgid));
    }

    #[test]
    fn stopping_ends_the_whole_group_and_says_nothing_more() {
        // The server's own child ignores SIGTERM, as a stuck JVM might.
        let (server, events) = serve("sh -c 'trap \"\" TERM; sleep 30' & printf 'Content-Length: 2\\r\\n\\r\\n{}'; sleep 30; wait");
        assert_eq!(events.recv_timeout(SOON).unwrap(), Event::Message("{}".into()));
        let pgid = server.shared.pgid;
        server.stop();
        assert!(wait_until_gone(pgid), "nothing in the group survived");
        assert_eq!(events.recv_timeout(SOON), Err(RecvTimeoutError::Disconnected), "no exit event for a deliberate stop");
    }

    #[test]
    fn quitting_waits_until_every_server_is_gone() {
        let servers: Vec<Server> = (0..3).map(|_| serve("sh -c 'trap \"\" TERM; sleep 30' & sleep 30; wait").0).collect();
        std::thread::sleep(Duration::from_millis(200));
        let start = Instant::now();
        stop_all_now(&servers);
        assert!(start.elapsed() < STOP_GRACE + Duration::from_secs(1), "the servers are stopped together, not one after another");
        std::thread::sleep(Duration::from_millis(100));
        for server in &servers {
            assert!(!group_alive(server.shared.pgid));
        }
    }

    #[test]
    fn what_a_server_left_running_is_stopped_when_it_exits() {
        let (server, events) = serve("sleep 30 & exit 0");
        assert_eq!(exit_of(&events).0, Some(0));
        assert!(wait_until_gone(server.shared.pgid));
    }

    #[test]
    fn a_server_that_never_reads_does_not_block_sending_and_is_given_up_on() {
        let (server, events) = serve("exec sleep 30");
        let message = "x".repeat(1024 * 1024);
        let start = Instant::now();
        for _ in 0..MAX_QUEUED / message.len() + 3 {
            server.send(&message);
        }
        assert!(start.elapsed() < Duration::from_secs(5), "sending never waits for the server");
        let (code, stderr) = exit_of(&events);
        assert_eq!(code, None);
        assert_eq!(stderr, "Longhand stopped the language server because it stopped reading what it was sent.");
    }

    #[test]
    fn a_flooding_server_is_held_back_until_its_messages_are_acknowledged() {
        // Six 1 MB messages: more than may be outstanding at once.
        let megabyte = 1024 * 1024;
        let script = format!("i=0; while [ $i -lt 6 ]; do printf 'Content-Length: {megabyte}\\r\\n\\r\\n'; head -c {megabyte} /dev/zero | tr '\\0' 'x'; i=$((i+1)); done; exec sleep 30");
        let (server, events) = serve(&script);
        // The first may take a while on a busy machine; after it, two quiet seconds mean held back.
        let mut received = usize::from(events.recv_timeout(SOON).is_ok());
        while events.recv_timeout(Duration::from_secs(2)).is_ok() {
            received += 1;
        }
        assert_eq!(received, 5, "the reader stopped once more than {MAX_UNACKED} bytes were unacknowledged");
        server.ack(megabyte);
        assert!(matches!(events.recv_timeout(SOON), Ok(Event::Message(_))), "an acknowledgement lets the next one through");
        server.stop();
    }

    #[test]
    fn sending_to_a_server_that_has_gone_is_harmless() {
        let (server, events) = serve("exit 0");
        exit_of(&events);
        server.send("{}");
        server.ack(10);
        server.stop();
    }

    #[test]
    fn a_program_that_cannot_be_started_is_an_error() {
        assert!(spawn(Command::new("/nonexistent/longhand-language-server"), |_| {}).is_err());
    }
}
