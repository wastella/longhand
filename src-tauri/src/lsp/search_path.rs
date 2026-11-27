//! Where to look for language servers: the PATH of the student's login shell.
//!
//! An app launched from Finder or the Dock gets a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`),
//! without Homebrew, `~/.cargo/bin`, nvm's node or anything else a shell profile adds. Servers
//! are both looked up and started with the login shell's PATH instead, so they are found where
//! the terminal finds them and can in turn find node, java, cargo and go. The few variables
//! those tools are configured with (`PASSED_ON`) come from the same shell.

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

/// Variables the servers' own tools read, taken from the login shell when it sets them.
const PASSED_ON: [&str; 5] = ["JAVA_HOME", "GOPATH", "GOROOT", "CARGO_HOME", "RUSTUP_HOME"];

// Profiles may print greetings and warnings, so each value is picked out between two markers.
fn start_of(name: &str) -> String {
    format!("__LONGHAND_{name}_START__")
}
fn end_of(name: &str) -> String {
    format!("__LONGHAND_{name}_END__")
}

/// What the login shell says about where tools are.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Environment {
    pub path: String,
    /// Those of `PASSED_ON` the shell has set.
    pub vars: Vec<(String, String)>,
}

impl Environment {
    pub fn var(&self, name: &str) -> Option<&str> {
        self.vars.iter().find(|(key, _)| key == name).map(|(_, value)| value.as_str())
    }
}

/// Places tools are commonly installed to, searched after the shell's own PATH in case the
/// profile could not be read or leaves one out.
const USUAL_PLACES: [&str; 5] = ["/opt/homebrew/bin", "/usr/local/bin", "~/.local/bin", "~/.cargo/bin", "~/go/bin"];

static RESOLVED: Mutex<Option<(Environment, Instant)>> = Mutex::new(None);

/// The shell's environment, worked out the first time it is needed and remembered after that.
pub fn current() -> Environment {
    let mut resolved = RESOLVED.lock().unwrap();
    match resolved.as_ref() {
        Some((environment, _)) => environment.clone(),
        None => resolved.insert((resolve(), Instant::now())).0.clone(),
    }
}

/// The environment worked out afresh, for when a server was not found with the remembered one:
/// the student may have just installed it somewhere a changed profile now names. `None` when
/// it was worked out less than `after` ago.
pub fn refreshed(after: Duration) -> Option<Environment> {
    let mut resolved = RESOLVED.lock().unwrap();
    if resolved.as_ref().is_some_and(|(_, at)| at.elapsed() < after) {
        return None;
    }
    Some(resolved.insert((resolve(), Instant::now())).0.clone())
}

fn resolve() -> Environment {
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/zsh".into());
    let home = std::env::var("HOME").unwrap_or_default();
    // Without an answer the servers get Longhand's own PATH, and inherit the rest from it.
    let asked = from_login_shell(&shell, SHELL_LIMIT)
        .unwrap_or_else(|| Environment { path: std::env::var("PATH").unwrap_or_default(), vars: Vec::new() });
    Environment { path: with_usual_places(&asked.path, Path::new(&home)), vars: asked.vars }
}

/// Asks `shell`, started as an interactive login shell so it reads the same profile files the
/// terminal does, for its PATH and the variables in `PASSED_ON`.
fn from_login_shell(shell: &str, limit: Duration) -> Option<Environment> {
    // fish keeps PATH as a list, which "$PATH" would join with spaces.
    let path = if shell.ends_with("/fish") { "(string join : $PATH)".to_string() } else { "\"$PATH\"".to_string() };
    let values = std::iter::once(("PATH", path)).chain(PASSED_ON.iter().map(|name| (*name, format!("\"${name}\""))));
    let script: Vec<String> = values.map(|(name, value)| format!("printf '%s%s%s' {} {value} {}", start_of(name), end_of(name))).collect();
    let mut command = Command::new(shell);
    command.args(["-ilc", &script.join("; ")]);
    let output = probe::run(command, limit)?.stdout;
    let vars = PASSED_ON.iter().filter_map(|name| Some((name.to_string(), between_markers(&output, name)?))).collect();
    Some(Environment { path: between_markers(&output, "PATH")?, vars })
}

fn between_markers(output: &str, name: &str) -> Option<String> {
    let (start, end) = (start_of(name), end_of(name));
    let from = output.rfind(&start)? + start.len();
    let length = output[from..].find(&end)?;
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
        let (start, end) = (start_of("PATH"), end_of("PATH"));
        let noisy = format!("Welcome back!\n{start}/opt/homebrew/bin:/usr/bin{end}\nbye\n");
        assert_eq!(between_markers(&noisy, "PATH").as_deref(), Some("/opt/homebrew/bin:/usr/bin"));
        assert_eq!(between_markers("Welcome back!\n", "PATH"), None);
        assert_eq!(between_markers(&format!("{start}{end}"), "PATH"), None);
        assert_eq!(between_markers(&format!("{start}/usr/bin"), "PATH"), None, "cut off before the end");
        assert_eq!(between_markers(&noisy, "GOPATH"), None, "another variable's markers");
    }

    #[test]
    fn a_real_shell_is_asked_for_its_path() {
        // /bin/sh stands in for the student's shell; it accepts the same flags.
        let path = from_login_shell("/bin/sh", Duration::from_secs(10)).expect("sh printed its PATH").path;
        assert!(path.split(':').any(|entry| entry == "/usr/bin" || entry == "/bin"), "{path}");
    }

    #[test]
    fn a_noisy_profile_does_not_spoil_the_answer() {
        let dir = temp_dir("lsp-shell-noisy");
        let said = format!("{}/a/bin:/b/bin{}", start_of("PATH"), end_of("PATH"));
        let shell = fake_shell(&dir, &format!("echo 'nvm is not compatible with...'; printf '%s' '{said}'; exit 1"));
        assert_eq!(from_login_shell(&shell, Duration::from_secs(5)).map(|e| e.path).as_deref(), Some("/a/bin:/b/bin"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_variables_tools_are_configured_with_come_from_the_shell_when_it_sets_them() {
        let dir = temp_dir("lsp-shell-vars");
        // Runs the script it is handed, as a shell would, with two of the variables set.
        let shell = fake_shell(&dir, "JAVA_HOME=/opt/java GOPATH='/Users/ada/my go' RUSTUP_HOME= exec /bin/sh -c \"$2\"");
        let environment = from_login_shell(&shell, Duration::from_secs(5)).unwrap();
        assert_eq!(environment.var("JAVA_HOME"), Some("/opt/java"));
        assert_eq!(environment.var("GOPATH"), Some("/Users/ada/my go"));
        assert_eq!(environment.var("RUSTUP_HOME"), None, "set but empty");
        assert_eq!(environment.var("GOROOT"), None);
        assert!(!environment.path.is_empty());
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
        let path = with_usual_places("/usr/bin::/opt/homebrew/bin:/Users/ada/.cargo/bin", Path::new("/Users/ada"));
        assert_eq!(path, "/usr/bin:/opt/homebrew/bin:/Users/ada/.cargo/bin:/usr/local/bin:/Users/ada/.local/bin:/Users/ada/go/bin");
    }

    #[test]
    fn the_path_is_remembered_and_not_asked_for_again_at_once() {
        let first = current();
        assert!(!first.path.is_empty());
        // Another test may have worked it out long enough ago for one fresh ask to be due.
        let latest = refreshed(REFRESH_AFTER).unwrap_or(first);
        assert_eq!(refreshed(REFRESH_AFTER), None, "it was worked out a moment ago");
        assert_eq!(current(), latest);
        assert!(refreshed(Duration::ZERO).is_some(), "asked for now, whatever its age");
    }
}
