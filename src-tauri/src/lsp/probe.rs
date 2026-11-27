//! Runs a short helper command (a login shell printing its PATH) and gives up on it after a
//! time limit, so a profile that hangs cannot hold up looking for a server.

use std::io::Read;
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

const POLL: Duration = Duration::from_millis(10);
/// How long to wait for the output of a command that has already exited. Something it started
/// may be holding the pipe open, and what it printed itself has arrived by then.
const OUTPUT_GRACE: Duration = Duration::from_millis(500);

/// Runs `command` with nothing on standard input and its errors discarded, and returns what it
/// printed as lossy UTF-8, however it exited. `None` when it could not be started or was still
/// running after `limit`: it is then killed with everything it started (a profile that launched
/// an agent, say).
pub fn run(mut command: Command, limit: Duration) -> Option<String> {
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    // A session of its own rather than only a process group: an interactive shell in a
    // background group of a terminal's session is stopped the moment it touches that terminal.
    // The session's id is the child's pid, and is also its process group's.
    unsafe {
        command.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    let mut child = command.spawn().ok()?;
    let group = child.id() as i32;
    let mut pipe = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = pipe.read_to_end(&mut bytes);
        let _ = tx.send(String::from_utf8_lossy(&bytes).into_owned());
    });
    let deadline = Instant::now() + limit;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(POLL),
            _ => {
                unsafe { libc::kill(-group, libc::SIGKILL) };
                let _ = child.wait();
                return None;
            }
        }
    }
    Some(rx.recv_timeout(OUTPUT_GRACE).unwrap_or_default())
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
    fn a_command_reports_its_output_however_it_exits() {
        assert_eq!(run(sh("echo found"), Duration::from_secs(5)).unwrap(), "found\n");
        // A profile that ends in a failing command has still printed the PATH.
        assert_eq!(run(sh("echo partly; exit 3"), Duration::from_secs(5)).unwrap(), "partly\n");
    }

    #[test]
    fn a_command_that_hangs_is_given_up_on() {
        let start = Instant::now();
        assert!(run(sh("sleep 30"), Duration::from_millis(200)).is_none());
        assert!(start.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn giving_up_also_ends_what_the_command_started() {
        let note = crate::workspace::tests::temp_dir("lsp-probe-group").join("pid");
        let script = format!("sleep 300 & echo $! > '{}'; wait", note.display());
        assert!(run(sh(&script), Duration::from_secs(5)).is_none());
        let pid: i32 = std::fs::read_to_string(&note).unwrap().trim().parse().unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        while unsafe { libc::kill(pid, 0) } == 0 && Instant::now() < deadline {
            std::thread::sleep(POLL);
        }
        assert_ne!(unsafe { libc::kill(pid, 0) }, 0, "the background sleep is gone too");
        std::fs::remove_dir_all(note.parent().unwrap()).unwrap();
    }

    #[test]
    fn a_command_that_does_not_exist_is_no_answer() {
        assert!(run(Command::new("/nonexistent/longhand-tool"), Duration::from_secs(1)).is_none());
    }

    #[test]
    fn output_held_open_by_a_background_process_does_not_hold_up_the_answer() {
        let start = Instant::now();
        assert!(run(sh("echo early; sleep 30 &"), Duration::from_secs(20)).is_some());
        assert!(start.elapsed() < Duration::from_secs(10));
    }
}
