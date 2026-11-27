//! Clone Repository: fetches an assignment with the student's own `git clone`, then the interface
//! opens the folder. Only plain `https://`, `ssh://` and `user@host:path` addresses are taken.
//! The address is one argument after `--`, never through a shell; anything git could read as an
//! option or a transport helper (`ext::`, `fd::`) is refused before git runs, and git itself is
//! told to use no protocol but https and ssh. Git never asks for a password here (there is no
//! terminal to type it in): a repository that needs signing in fails with a sentence saying so.
//!
//! Progress is sent as `clone:progress` events, `{ id, stage, percent }`.

use regex::Regex;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;

/// The clones running now, by the interface's id: the process group to stop on Cancel, and
/// whether Cancel was asked for.
#[derive(Default)]
pub struct Clones(Mutex<HashMap<String, (u32, bool)>>);

/// How many lines of git's messages are kept to explain a failure.
const KEPT_LINES: usize = 20;

/// A failure the interface shows: `{ code, message }`.
fn failure(code: &str, message: impl Into<String>) -> Value {
    json!({ "code": code, "message": message.into() })
}

const URL_HELP: &str =
    "Use the address the course gives for cloning, starting with https:// or git@ (for example https://github.com/user/assignment.git).";

/// Checks that `url` is a plain https, ssh or scp-style (`user@host:path`) address with nothing
/// git could take for an option or a transport helper.
pub fn check_url(url: &str) -> Result<(), String> {
    let refuse = |why: &str| Err(format!("{why} {URL_HELP}"));
    if url.is_empty() {
        return refuse("Enter the repository's address.");
    }
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return refuse("The address cannot contain spaces.");
    }
    if url.starts_with('-') {
        return refuse("That is not a repository address.");
    }
    // `<helper>::<address>` runs a transport helper, which can run any command.
    if url.contains("::") {
        return refuse("That kind of address is not supported.");
    }
    static WEB: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^https://([^/@]+@)?[A-Za-z0-9][A-Za-z0-9.-]*(:\d+)?/[^/].*$").unwrap());
    static SSH: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^ssh://([A-Za-z0-9._~][A-Za-z0-9._~-]*@)?[A-Za-z0-9][A-Za-z0-9.-]*(:\d+)?/[^/].*$").unwrap());
    static SCP: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^[A-Za-z0-9._~][A-Za-z0-9._~-]*@[A-Za-z0-9][A-Za-z0-9.-]*:[^/:-].*$").unwrap());
    if WEB.is_match(url) || SSH.is_match(url) || SCP.is_match(url) {
        return Ok(());
    }
    if url.starts_with("http://") {
        return refuse("Plain http:// is not supported; use the https:// address.");
    }
    refuse("That is not an address Longhand can clone from.")
}

/// Checks the name of the folder the clone goes into.
pub fn check_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Enter a name for the folder.".into());
    }
    if name.contains('/') || name.contains('\0') || name == "." || name == ".." || name.starts_with('-') {
        return Err("The folder name cannot contain / or start with -.".into());
    }
    Ok(())
}

/// The arguments for `git` that clone `url` into `dest`: only https and ssh are allowed (so a
/// redirect or a submodule cannot switch to another protocol), the address follows `--`.
pub fn clone_args(url: &str, dest: &Path) -> Vec<OsString> {
    let mut args: Vec<OsString> = [
        "-c",
        "protocol.allow=never",
        "-c",
        "protocol.https.allow=always",
        "-c",
        "protocol.ssh.allow=always",
        "clone",
        "--progress",
        "--",
        url,
    ]
    .iter()
    .map(OsString::from)
    .collect();
    args.push(dest.as_os_str().to_owned());
    args
}

/// A progress line from git: "Receiving objects:  45% (45/100), 1.2 MiB | 2 MiB/s" gives
/// ("Receiving objects", 45).
pub fn parse_progress(line: &str) -> Option<(String, u32)> {
    static LINE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?:remote: )?([A-Za-z][A-Za-z ]*[a-z]):\s+(\d{1,3})%").unwrap());
    let found = LINE.captures(line.trim())?;
    Some((found[1].to_string(), found[2].parse().ok()?))
}

/// What went wrong, from git's messages: `{ code, message }` with a sentence a student can act on.
pub fn explain_failure(messages: &str) -> Value {
    let text = messages.to_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| text.contains(n));
    if has(&["host key verification failed"]) {
        return failure("host-key", "SSH does not know this server yet. Connect to it once from Terminal (for example ssh -T git@github.com) to trust it, or use the https:// address.");
    }
    if has(&[
        "could not read username",
        "could not read password",
        "authentication failed",
        "terminal prompts disabled",
        "permission denied (publickey",
        "invalid username or password",
    ]) {
        return failure("auth", "Git could not sign in to this repository. For a private repository, set up Git's sign-in first (for example gh auth login, or an SSH key on your account), then try again.");
    }
    if has(&["repository not found", "does not appear to be a git repository", "does not exist", "not found"]) {
        return failure(
            "not-found",
            "No repository was found at this address. Check the address, and that your account can see the repository.",
        );
    }
    if has(&[
        "could not resolve host",
        "could not resolve hostname",
        "failed to connect",
        "network is unreachable",
        "timed out",
        "connection refused",
    ]) {
        return failure("offline", "Could not reach the server. Check your internet connection and the address.");
    }
    if has(&["already exists and is not an empty directory"]) {
        return failure("exists", "A folder with that name is already there. Choose another name or location.");
    }
    if has(&["not allowed"]) {
        return failure("invalid-url", format!("That kind of address is not supported. {URL_HELP}"));
    }
    let last = messages.lines().map(str::trim).rfind(|line| !line.is_empty()).unwrap_or("git stopped without saying why");
    failure("failed", format!("Git could not clone the repository: {last}"))
}

/// The student's git. Apps launched from Finder do not get the shell's PATH, so a login shell
/// is asked too. On a Mac without the command-line tools, /usr/bin/git is only a stub that offers
/// to install them, which `git --version` failing reveals.
fn find_git() -> Option<PathBuf> {
    let from_shell = || {
        let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/zsh".into());
        let out = Command::new(shell).args(["-ilc", "command -v git"]).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout).to_string();
        Some(PathBuf::from(text.lines().last()?.trim()))
    };
    let works = |git: &PathBuf| {
        git.is_absolute() && Command::new(git).arg("--version").stdin(Stdio::null()).output().is_ok_and(|out| out.status.success())
    };
    ["/opt/homebrew/bin/git", "/usr/local/bin/git"]
        .iter()
        .map(PathBuf::from)
        .filter(|git| git.exists())
        .chain(from_shell())
        .chain(Some(PathBuf::from("/usr/bin/git")))
        .find(works)
}

/// Runs git with `args` in `cwd`, calling `progress` for each progress line and `started` with
/// the process id. Resolves to git's messages when it fails.
fn run_git(
    git: &Path,
    args: &[OsString],
    cwd: &Path,
    mut progress: impl FnMut(&str, u32),
    started: impl FnOnce(u32),
) -> Result<(), String> {
    use std::os::unix::process::CommandExt;
    let mut child = Command::new(git)
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        // Its own process group, so Cancel stops git and the helpers it starts.
        .process_group(0)
        .spawn()
        .map_err(|e| format!("git could not start: {e}"))?;
    started(child.id());
    let mut stderr = child.stderr.take().expect("stderr is piped");
    let mut kept: Vec<String> = Vec::new();
    let mut pending = Vec::new();
    let mut buffer = [0u8; 4096];
    let mut take_line = |line: &[u8], kept: &mut Vec<String>| {
        let line = String::from_utf8_lossy(line).trim().to_string();
        if line.is_empty() {
            return;
        }
        match parse_progress(&line) {
            Some((stage, percent)) => progress(&stage, percent),
            None => {
                kept.push(line);
                if kept.len() > KEPT_LINES {
                    kept.remove(0);
                }
            }
        }
    };
    // git rewrites a progress line with \r, and ends finished lines with \n.
    while let Ok(n) = stderr.read(&mut buffer) {
        if n == 0 {
            break;
        }
        for byte in &buffer[..n] {
            if *byte == b'\r' || *byte == b'\n' {
                take_line(&pending, &mut kept);
                pending.clear();
            } else {
                pending.push(*byte);
            }
        }
    }
    take_line(&pending, &mut kept);
    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(kept.join("\n"))
    }
}

/// Clones `url` into a new folder `name` inside `parent`, and resolves to `{ path }`. Failures are
/// `{ code, message }`, code one of `invalid-url`, `invalid-name`, `location`, `exists`,
/// `git-missing`, `auth`, `not-found`, `offline`, `host-key`, `cancelled` or `failed`.
#[tauri::command]
pub async fn clone_start(
    app: AppHandle,
    clones: State<'_, Clones>,
    id: String,
    url: String,
    parent: String,
    name: String,
) -> Result<Value, Value> {
    let url = url.trim().to_string();
    check_url(&url).map_err(|e| failure("invalid-url", e))?;
    check_name(&name).map_err(|e| failure("invalid-name", e))?;
    let parent = PathBuf::from(parent);
    if !parent.is_absolute() || !parent.is_dir() {
        return Err(failure("location", "The location for the clone no longer exists. Choose another."));
    }
    let dest = parent.join(name.trim());
    if dest.symlink_metadata().is_ok() {
        return Err(failure(
            "exists",
            format!("{} already has something named {}. Choose another name or location.", parent.display(), name.trim()),
        ));
    }
    let git = tauri::async_runtime::spawn_blocking(find_git).await.ok().flatten().ok_or_else(|| {
        failure("git-missing", "Git is not installed. Install the Xcode command-line tools (run xcode-select --install in Terminal) or Git from git-scm.com, then try again.")
    })?;

    let args = clone_args(&url, &dest);
    let runs = &clones.0;
    let emitter = app.clone();
    let run_id = id.clone();
    let result = tauri::async_runtime::spawn_blocking({
        let dest = dest.clone();
        let parent = parent.clone();
        let app = app.clone();
        move || {
            let started = |pid| {
                let clones: State<Clones> = tauri::Manager::state(&app);
                clones.0.lock().unwrap().insert(run_id.clone(), (pid, false));
            };
            let progress = |stage: &str, percent| {
                let _ = emitter.emit("clone:progress", json!({ "id": run_id, "stage": stage, "percent": percent }));
            };
            let outcome = run_git(&git, &args, &parent, progress, started);
            if outcome.is_err() && dest.exists() {
                // Checked absent before git started, so this is git's half-made folder.
                let _ = std::fs::remove_dir_all(&dest);
            }
            outcome
        }
    })
    .await
    .map_err(|e| failure("failed", e.to_string()))?;
    let cancelled = runs.lock().unwrap().remove(&id).is_some_and(|(_, cancelled)| cancelled);
    match result {
        Ok(()) => Ok(json!({ "path": dest.to_string_lossy() })),
        Err(_) if cancelled => Err(failure("cancelled", "The clone was cancelled.")),
        Err(messages) => Err(explain_failure(&messages)),
    }
}

/// Stops the clone `id`, if it is running.
#[tauri::command]
pub fn clone_cancel(clones: State<Clones>, id: String) {
    if let Some((pid, cancelled)) = clones.0.lock().unwrap().get_mut(&id) {
        *cancelled = true;
        unsafe { libc::kill(-(*pid as i32), libc::SIGTERM) };
    }
}

/// Asks where to put the clone; None when the student cancels.
#[tauri::command]
pub async fn clone_choose(app: AppHandle) -> Option<String> {
    let picked = app.dialog().file().set_title("Choose Where to Clone").blocking_pick_folder()?;
    picked.into_path().ok().map(|p| p.to_string_lossy().to_string())
}

/// Where a clone goes unless the student chooses: their home folder.
#[tauri::command]
pub fn clone_location() -> String {
    std::env::var("HOME").unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::tests::temp_dir;

    #[test]
    fn plain_https_ssh_and_scp_addresses_are_accepted() {
        for url in [
            "https://github.com/stanford-cs336/assignment1-basics.git",
            "https://github.com/stanford-cs336/assignment1-basics",
            "https://gitlab.example.edu:8443/course/hw1.git",
            "https://student@bitbucket.org/team/repo.git",
            "ssh://git@github.com/stanford-cs336/assignment1-basics.git",
            "ssh://git@example.edu:2222/srv/hw.git",
            "git@github.com:stanford-cs336/assignment1-basics.git",
            "student@cs.example.edu:repos/hw1.git",
        ] {
            assert_eq!(check_url(url), Ok(()), "{url}");
        }
    }

    #[test]
    fn options_transport_helpers_and_other_protocols_are_refused() {
        for url in [
            "",
            "--upload-pack=touch /tmp/pwned",
            "-uhttps://github.com/a/b",
            "ext::sh -c touch% /tmp/pwned",
            "fd::17",
            "https::github.com/a/b",
            "file:///etc",
            "/Users/someone/repo",
            "../repo",
            "http://github.com/a/b.git",
            "git://github.com/a/b.git",
            "ssh://-oProxyCommand=touch/x",
            "ssh://git@-oProxyCommand=x/y",
            "git@-oProxyCommand=x:y",
            "git@github.com:-u/x",
            "-oProxyCommand=x@host:path",
            "https://github.com/a b",
            "https://github.com/a\nb",
            "https://",
            "https://github.com",
            "https:///a/b",
            "ftp://example.com/a",
        ] {
            assert!(check_url(url).is_err(), "{url:?} should be refused");
        }
        assert!(check_url("http://github.com/a/b").unwrap_err().contains("https://"));
    }

    #[test]
    fn folder_names_stay_inside_the_location() {
        assert_eq!(check_name("assignment1-basics"), Ok(()));
        assert_eq!(check_name("my repo"), Ok(()));
        for name in ["", "  ", "a/b", "..", ".", "-rf"] {
            assert!(check_name(name).is_err(), "{name:?}");
        }
    }

    #[test]
    fn the_arguments_allow_only_https_and_ssh_and_put_the_address_after_dashes() {
        let args = clone_args("https://github.com/a/b.git", Path::new("/tmp/b"));
        let args: Vec<&str> = args.iter().map(|a| a.to_str().unwrap()).collect();
        assert_eq!(
            args,
            [
                "-c",
                "protocol.allow=never",
                "-c",
                "protocol.https.allow=always",
                "-c",
                "protocol.ssh.allow=always",
                "clone",
                "--progress",
                "--",
                "https://github.com/a/b.git",
                "/tmp/b"
            ]
        );
    }

    #[test]
    fn progress_lines_give_a_stage_and_a_percentage() {
        assert_eq!(parse_progress("Receiving objects:  45% (45/100), 1.20 MiB | 2.00 MiB/s"), Some(("Receiving objects".into(), 45)));
        assert_eq!(parse_progress("remote: Compressing objects: 100% (8/8), done."), Some(("Compressing objects".into(), 100)));
        assert_eq!(parse_progress("Resolving deltas:   0% (0/3)"), Some(("Resolving deltas".into(), 0)));
        assert_eq!(parse_progress("Cloning into 'b'..."), None);
        assert_eq!(parse_progress("remote: Enumerating objects: 12, done."), None);
    }

    #[test]
    fn failures_are_explained_in_words_a_student_can_act_on() {
        let code = |text: &str| explain_failure(text)["code"].as_str().unwrap().to_string();
        assert_eq!(code("fatal: could not read Username for 'https://github.com': terminal prompts disabled"), "auth");
        assert_eq!(code("git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository."), "auth");
        assert_eq!(code("remote: Repository not found.\nfatal: repository 'https://github.com/a/b/' not found"), "not-found");
        assert_eq!(code("fatal: unable to access 'https://x/': Could not resolve host: x"), "offline");
        assert_eq!(code("Host key verification failed.\nfatal: Could not read from remote repository."), "host-key");
        assert_eq!(code("fatal: destination path 'b' already exists and is not an empty directory."), "exists");
        assert_eq!(code("fatal: transport 'file' not allowed"), "invalid-url");
        let other = explain_failure("warning: something\nfatal: the disk is full\n");
        assert_eq!(other["code"], "failed");
        assert!(other["message"].as_str().unwrap().ends_with("fatal: the disk is full"));
    }

    fn git() -> PathBuf {
        find_git().expect("git is installed where the tests run")
    }

    /// A bare repository with one commit, standing in for a course's repository.
    fn bare_repo(dir: &Path) -> PathBuf {
        let work = dir.join("work");
        let bare = dir.join("course.git");
        std::fs::create_dir_all(&work).unwrap();
        std::fs::write(work.join("handout.md"), "# Assignment 1\n").unwrap();
        let run = |args: &[&str], cwd: &Path| {
            let ok = Command::new(git())
                .args(args)
                .current_dir(cwd)
                .env("GIT_AUTHOR_NAME", "t")
                .env("GIT_AUTHOR_EMAIL", "t@t")
                .env("GIT_COMMITTER_NAME", "t")
                .env("GIT_COMMITTER_EMAIL", "t@t")
                .output()
                .unwrap();
            assert!(ok.status.success(), "{}", String::from_utf8_lossy(&ok.stderr));
        };
        run(&["init", "-q"], &work);
        run(&["add", "."], &work);
        run(&["commit", "-qm", "starter"], &work);
        run(&["clone", "-q", "--bare", work.to_str().unwrap(), bare.to_str().unwrap()], dir);
        bare
    }

    #[test]
    fn git_clones_a_repository_and_reports_its_progress() {
        let dir = temp_dir("clone");
        let bare = bare_repo(&dir);
        let dest = dir.join("assignment");
        let args: Vec<OsString> = ["clone", "--progress", "--no-local", "--", bare.to_str().unwrap(), dest.to_str().unwrap()]
            .iter()
            .map(OsString::from)
            .collect();
        let mut stages = Vec::new();
        let mut pid = 0;
        run_git(&git(), &args, &dir, |stage, percent| stages.push((stage.to_string(), percent)), |id| pid = id).unwrap();
        assert!(pid > 0);
        assert_eq!(std::fs::read_to_string(dest.join("handout.md")).unwrap(), "# Assignment 1\n");
        assert!(stages.iter().any(|(stage, percent)| stage == "Receiving objects" && *percent == 100), "{stages:?}");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_real_arguments_refuse_a_local_path_and_an_existing_folder() {
        let dir = temp_dir("clone-refused");
        let bare = bare_repo(&dir);
        let url = format!("file://{}", bare.display());
        let messages = run_git(&git(), &clone_args(&url, &dir.join("a")), &dir, |_, _| {}, |_| {}).unwrap_err();
        assert_eq!(explain_failure(&messages)["code"], "invalid-url", "{messages}");
        assert!(!dir.join("a").exists());

        std::fs::create_dir_all(dir.join("taken")).unwrap();
        std::fs::write(dir.join("taken/file"), "mine").unwrap();
        let args: Vec<OsString> = ["clone", "--", bare.to_str().unwrap(), "taken"].iter().map(OsString::from).collect();
        let messages = run_git(&git(), &args, &dir, |_, _| {}, |_| {}).unwrap_err();
        assert_eq!(explain_failure(&messages)["code"], "exists");
        assert_eq!(std::fs::read_to_string(dir.join("taken/file")).unwrap(), "mine");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_missing_repository_is_reported_as_not_found() {
        let dir = temp_dir("clone-missing");
        let args: Vec<OsString> = ["clone", "--", dir.join("nothing.git").to_str().unwrap(), "x"].iter().map(OsString::from).collect();
        let messages = run_git(&git(), &args, &dir, |_, _| {}, |_| {}).unwrap_err();
        assert_eq!(explain_failure(&messages)["code"], "not-found", "{messages}");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
