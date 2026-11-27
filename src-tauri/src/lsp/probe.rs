//! Runs a short helper command (`rustup which`, `xcrun -f`, a login shell printing its PATH) and
//! gives up on it after a time limit, so a tool that hangs cannot hold up looking for a server.

use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

const POLL: Duration = Duration::from_millis(10);
/// How long to wait for the output of a command that has already exited. Something it started
/// may be holding the pipe open, and what it printed itself has arrived by then.
const OUTPUT_GRACE: Duration = Duration::from_millis(500);

pub struct Outcome {
    /// Whether the command exited with status 0.
    pub success: bool,
    /// What it printed, as lossy UTF-8.
    pub stdout: String,
}

/// Runs `command` with nothing on standard input and its errors discarded. `None` when it could
/// not be started or was still running after `limit` (it is then killed).
pub fn run(mut command: Command, limit: Duration) -> Option<Outcome> {
    let mut child = command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let mut pipe = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = pipe.read_to_end(&mut bytes);
        let _ = tx.send(String::from_utf8_lossy(&bytes).into_owned());
    });
    let deadline = Instant::now() + limit;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(POLL),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    };
    Some(Outcome { success: status.success(), stdout: rx.recv_timeout(OUTPUT_GRACE).unwrap_or_default() })
}

/// The trimmed output of a command that succeeded and printed something.
pub fn answer(command: Command, limit: Duration) -> Option<String> {
    let outcome = run(command, limit)?;
    let text = outcome.stdout.trim();
    (outcome.success && !text.is_empty()).then(|| text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sh(script: &str) -> Command {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", script]);
        command
    }

    #[test]
    fn a_command_reports_its_output_and_whether_it_succeeded() {
        let ok = run(sh("echo found"), Duration::from_secs(5)).unwrap();
        assert!(ok.success);
        assert_eq!(ok.stdout, "found\n");
        let failed = run(sh("echo partly; exit 3"), Duration::from_secs(5)).unwrap();
        assert!(!failed.success);
        assert_eq!(failed.stdout, "partly\n");
    }

    #[test]
    fn an_answer_needs_success_and_some_output() {
        assert_eq!(answer(sh("echo ' /usr/bin/tool '"), Duration::from_secs(5)).as_deref(), Some("/usr/bin/tool"));
        assert_eq!(answer(sh("echo /usr/bin/tool; exit 1"), Duration::from_secs(5)), None);
        assert_eq!(answer(sh("true"), Duration::from_secs(5)), None);
    }

    #[test]
    fn a_command_that_hangs_is_given_up_on() {
        let start = Instant::now();
        assert!(run(sh("sleep 30"), Duration::from_millis(200)).is_none());
        assert!(start.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn a_command_that_does_not_exist_is_no_answer() {
        assert!(run(Command::new("/nonexistent/longhand-tool"), Duration::from_secs(1)).is_none());
    }

    #[test]
    fn output_held_open_by_a_background_process_does_not_hold_up_the_answer() {
        let start = Instant::now();
        let outcome = run(sh("echo early; sleep 3 &"), Duration::from_secs(5)).unwrap();
        assert!(outcome.success);
        assert!(start.elapsed() < Duration::from_secs(2));
    }
}
