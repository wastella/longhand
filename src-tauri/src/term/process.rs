//! What the operating system knows about a terminal's processes: which ones belong to it, what
//! is running in the foreground, where the shell is, and how to stop all of them.
//!
//! Each shell is a session leader (portable-pty calls setsid), so its session id is its pid and
//! everything it starts, including jobs in their own process groups, shares that session.

use std::path::PathBuf;
use std::time::{Duration, Instant};

/// How long processes get to exit after SIGHUP before they are killed outright.
const HANGUP_GRACE: Duration = Duration::from_millis(300);

/// Every process in the session `sid`, the leader included while it is alive.
pub fn session_members(sid: i32) -> Vec<i32> {
    all_pids().into_iter().filter(|&pid| pid > 0 && unsafe { libc::getsid(pid) } == sid).collect()
}

#[cfg(target_os = "macos")]
fn all_pids() -> Vec<i32> {
    let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
    if count <= 0 {
        return Vec::new();
    }
    // Room for processes started between the two calls.
    let mut pids = vec![0i32; count as usize + 64];
    let size = (pids.len() * std::mem::size_of::<i32>()) as i32;
    let filled = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), size) };
    pids.truncate(filled.max(0) as usize);
    pids
}

#[cfg(not(target_os = "macos"))]
fn all_pids() -> Vec<i32> {
    std::fs::read_dir("/proc").map(|dir| dir.flatten().filter_map(|e| e.file_name().to_str()?.parse().ok()).collect()).unwrap_or_default()
}

/// Stops every process in each of these sessions: a hangup first, as closing a terminal window
/// sends, then SIGKILL for whatever is still there after a short grace period.
pub fn terminate_sessions(sids: &[i32]) {
    let members = || sids.iter().flat_map(|&sid| session_members(sid)).collect::<Vec<_>>();
    let signal_all = |pids: &[i32], signal| {
        for &pid in pids {
            unsafe { libc::kill(pid, signal) };
        }
    };
    signal_all(&members(), libc::SIGHUP);
    let deadline = Instant::now() + HANGUP_GRACE;
    loop {
        let left = members();
        if left.is_empty() {
            return;
        }
        if Instant::now() >= deadline {
            return signal_all(&left, libc::SIGKILL);
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// The command line of `pid`, shortened for a dialog, or None if it has gone.
pub fn command_line(pid: i32) -> Option<String> {
    let out = std::process::Command::new("ps").args(["-o", "args=", "-p", &pid.to_string()]).output().ok()?;
    let line = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!line.is_empty()).then(|| shorten(&line, 60))
}

fn shorten(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let kept: String = text.chars().take(max - 1).collect();
    format!("{}…", kept.trim_end())
}

/// The working directory of `pid`.
#[cfg(target_os = "macos")]
pub fn cwd(pid: i32) -> Option<PathBuf> {
    use std::os::unix::ffi::OsStrExt;
    let mut info: libc::proc_vnodepathinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_vnodepathinfo>() as i32;
    let filled =
        unsafe { libc::proc_pidinfo(pid, libc::PROC_PIDVNODEPATHINFO, 0, (&mut info as *mut libc::proc_vnodepathinfo).cast(), size) };
    if filled != size {
        return None;
    }
    let path = unsafe { std::ffi::CStr::from_ptr(info.pvi_cdir.vip_path.as_ptr().cast()) };
    (!path.is_empty()).then(|| PathBuf::from(std::ffi::OsStr::from_bytes(path.to_bytes())))
}

#[cfg(not(target_os = "macos"))]
pub fn cwd(pid: i32) -> Option<PathBuf> {
    std::fs::read_link(format!("/proc/{pid}/cwd")).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};

    fn wait_until(what: &str, check: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !check() {
            assert!(Instant::now() < deadline, "timed out waiting for {what}");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn terminating_a_session_stops_background_jobs_too() {
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        let mut cmd = CommandBuilder::new("/bin/sh");
        // Background jobs get their own process groups under job control; they share the session.
        cmd.args(["-c", "set -m; sleep 60 & sleep 60 & trap '' HUP; sleep 60"]);
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        let sid = child.process_id().unwrap() as i32;
        wait_until("the jobs to start", || session_members(sid).len() >= 4);
        terminate_sessions(&[sid]);
        child.wait().unwrap();
        wait_until("every member to go", || session_members(sid).is_empty());
    }

    #[test]
    fn reads_a_command_line_and_a_working_directory() {
        let me = std::process::id() as i32;
        assert!(command_line(me).unwrap().contains("longhand"));
        assert_eq!(cwd(me).unwrap().canonicalize().unwrap(), std::env::current_dir().unwrap().canonicalize().unwrap());
        assert_eq!(command_line(i32::MAX), None);
    }

    #[test]
    fn long_command_lines_are_shortened() {
        assert_eq!(shorten("uv run python train.py", 60), "uv run python train.py");
        assert_eq!(shorten("abcdef ghij", 8), "abcdef…");
    }
}
