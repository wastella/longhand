//! Where to look for language servers: the PATH of the student's login shell.
//!
//! An app launched from Finder or the Dock gets a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`),
//! without Homebrew, `~/.local/bin`, nvm's node or anything else a shell profile adds. Servers
//! are both looked up and started with the login shell's PATH instead, so they are found where
//! the terminal finds them and can in turn find what they run on (basedpyright needs node).

use super::probe;
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// A profile that takes longer than this to load (or waits for input) is given up on.
const SHELL_LIMIT: Duration = Duration::from_secs(5);
/// While a server the student is installing is being waited for, the shell is asked again in
/// case a profile changed, but no more often than this: each ask starts a shell and reads the
/// student's whole profile.
pub const REFRESH_AFTER: Duration = Duration::from_secs(15);

// Profiles may print greetings and warnings, so the PATH is picked out between two markers.
const START: &str = "__LONGHAND_PATH_START__";
const END: &str = "__LONGHAND_PATH_END__";

/// Places tools are commonly installed to, searched after the shell's own PATH in case the
/// profile could not be read or leaves one out. `uv tool install` and `pipx` use `~/.local/bin`.
const USUAL_PLACES: [&str; 3] = ["/opt/homebrew/bin", "/usr/local/bin", "~/.local/bin"];

static RESOLVED: Mutex<Option<(String, Instant)>> = Mutex::new(None);

/// The shell's PATH, worked out the first time it is needed and remembered after that.
pub fn current() -> String {
    let mut resolved = RESOLVED.lock().unwrap();
    match resolved.as_ref() {
        Some((environment, _)) => environment.clone(),
        None => resolved.insert((resolve(), Instant::now())).0.clone(),
    }
}

/// The PATH worked out afresh, for when a server was not found with the remembered one: the
/// student may have just installed it somewhere a changed profile now names. `None` when it was
/// worked out less than `after` ago.
pub fn refreshed(after: Duration) -> Option<String> {
    let mut resolved = RESOLVED.lock().unwrap();
    if resolved.as_ref().is_some_and(|(_, at)| at.elapsed() < after) {
        return None;
    }
    Some(resolved.insert((resolve(), Instant::now())).0.clone())
}

fn resolve() -> String {
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/zsh".into());
    let home = std::env::var("HOME").unwrap_or_default();
    // Without an answer the servers get Longhand's own PATH.
    let asked = from_login_shell(&shell, SHELL_LIMIT).unwrap_or_else(|| std::env::var("PATH").unwrap_or_default());
    with_usual_places(&asked, Path::new(&home))
}

/// Asks `shell`, started as an interactive login shell so it reads the same profile files the
/// terminal does, for its PATH.
fn from_login_shell(shell: &str, limit: Duration) -> Option<String> {
    // fish keeps PATH as a list, which "$PATH" would join with spaces.
    let path = if shell.ends_with("/fish") { "(string join : $PATH)" } else { "\"$PATH\"" };
    let mut command = Command::new(shell);
    command.args(["-ilc", &format!("printf '%s%s%s' {START} {path} {END}")]);
    between_markers(&probe::run(command, limit)?)
}

fn between_markers(output: &str) -> Option<String> {
    let from = output.rfind(START)? + START.len();
    let length = output[from..].find(END)?;
    let value = output[from..from + length].trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// `path` followed by the usual places it does not already name.
fn with_usual_places(path: &str, home: &Path) -> String {
    let mut entries: Vec<String> = path.split(':').filter(|entry| !entry.is_empty()).map(String::from).collect();
    for place in USUAL_PLACES {
        let place = match place.strip_prefix("~/") {
            Some(rest) => home.join(rest).to_string_lossy().into_owned(),
            None => place.to_string(),
        };
        if !entries.contains(&place) {
            entries.push(place);
        }
    }
    entries.join(":")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::tests::temp_dir;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    /// A stand-in shell: a script that ignores its arguments and does `body`.
    fn fake_shell(dir: &Path, body: &str) -> String {
        let shell = dir.join("shell");
        fs::write(&shell, format!("#!/bin/sh\n{body}\n")).unwrap();
        fs::set_permissions(&shell, fs::Permissions::from_mode(0o755)).unwrap();
        shell.to_string_lossy().into_owned()
    }

    #[test]
    fn the_path_is_picked_out_of_whatever_else_a_profile_prints() {
        let noisy = format!("Welcome back!\n{START}/opt/homebrew/bin:/usr/bin{END}\nbye\n");
        assert_eq!(between_markers(&noisy).as_deref(), Some("/opt/homebrew/bin:/usr/bin"));
        assert_eq!(between_markers("Welcome back!\n"), None);
        assert_eq!(between_markers(&format!("{START}{END}")), None);
        assert_eq!(between_markers(&format!("{START}/usr/bin")), None, "cut off before the end");
    }

    #[test]
    fn a_real_shell_is_asked_for_its_path() {
        // /bin/sh stands in for the student's shell; it accepts the same flags.
        let path = from_login_shell("/bin/sh", Duration::from_secs(10)).expect("sh printed its PATH");
        assert!(path.split(':').any(|entry| entry == "/usr/bin" || entry == "/bin"), "{path}");
    }

    #[test]
    fn a_noisy_profile_does_not_spoil_the_answer() {
        let dir = temp_dir("lsp-shell-noisy");
        let said = format!("{START}/a/bin:/b/bin{END}");
        let shell = fake_shell(&dir, &format!("echo 'nvm is not compatible with...'; printf '%s' '{said}'; exit 1"));
        assert_eq!(from_login_shell(&shell, Duration::from_secs(5)).as_deref(), Some("/a/bin:/b/bin"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_profile_that_hangs_or_a_missing_shell_gives_no_path() {
        let dir = temp_dir("lsp-shell-hangs");
        let shell = fake_shell(&dir, "sleep 30");
        let start = Instant::now();
        assert_eq!(from_login_shell(&shell, Duration::from_millis(300)), None);
        assert!(start.elapsed() < Duration::from_secs(5));
        assert_eq!(from_login_shell("/nonexistent/shell", Duration::from_secs(1)), None);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_usual_places_follow_the_shells_path_without_repeats() {
        let path = with_usual_places("/usr/bin::/opt/homebrew/bin:/Users/ada/.local/bin", Path::new("/Users/ada"));
        assert_eq!(path, "/usr/bin:/opt/homebrew/bin:/Users/ada/.local/bin:/usr/local/bin");
    }

    #[test]
    fn the_path_is_remembered_and_not_asked_for_again_at_once() {
        let first = current();
        assert!(!first.is_empty());
        // Another test may have worked it out long enough ago for one fresh ask to be due.
        let latest = refreshed(REFRESH_AFTER).unwrap_or(first);
        assert_eq!(refreshed(REFRESH_AFTER), None, "it was worked out a moment ago");
        assert_eq!(current(), latest);
        assert!(refreshed(Duration::ZERO).is_some(), "asked for now, whatever its age");
    }
}
