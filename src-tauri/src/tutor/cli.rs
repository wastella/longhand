//! Finding the user's `claude` CLI, checking it can run the tutor safely, and the exact
//! arguments every tutor run starts with.

use super::prompt::Kind;
use super::threads::valid_session;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::SystemTime;

pub const READ_ONLY_TOOLS: [&str; 3] = ["Read", "Glob", "Grep"];

/// Flags the tutor relies on. A CLI whose `--help` lacks one is too old to run it safely.
const REQUIRED_FLAGS: [&str; 9] = [
    "--tools",
    "--restricted",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--permission-mode",
    "--input-format",
    "--include-partial-messages",
    "--no-session-persistence",
    "--effort",
];

/// How a run relates to the CLI's own record of the conversation.
#[derive(Debug, Clone, PartialEq)]
pub enum Session {
    /// A new conversation the CLI keeps under `id`, so later runs can resume it.
    New { id: String, system_prompt: String },
    /// A conversation the CLI already has. The CLI reuses the system prompt it recorded for it;
    /// `system_prompt` (the current policy's) is passed too, and applies if that record is gone.
    Resume { id: String, system_prompt: String },
    /// A one-off answer the CLI does not keep (lookups).
    Ephemeral { system_prompt: String },
}

/// The arguments for one run. The first block is what makes the tutor read-only; the test below
/// pins it, so any change to it is a deliberate one. Lookups get no tools at all.
///
/// Every value that could come from a file is joined to its flag with `=`, so it can never be
/// read as a flag of its own, and a session id must be a plain UUID.
pub fn args(model: &str, kind: Kind, session: &Session) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--tools",
        kind.tools(),
        "--restricted",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--permission-mode",
        "dontAsk",
        "--model",
        model,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    if let Some(effort) = kind.effort() {
        args.extend(["--effort".into(), effort.into()]);
    }
    match session {
        Session::New { id, system_prompt } => {
            if !valid_session(id) {
                return Err(format!("not a session id: {id:?}"));
            }
            args.extend([format!("--session-id={id}"), format!("--system-prompt={system_prompt}")])
        }
        Session::Resume { id, system_prompt } => {
            if !valid_session(id) {
                return Err(format!("not a session id: {id:?}"));
            }
            args.extend([format!("--resume={id}"), format!("--system-prompt={system_prompt}")])
        }
        Session::Ephemeral { system_prompt } => {
            args.extend(["--no-session-persistence".into(), format!("--system-prompt={system_prompt}")])
        }
    }
    Ok(args)
}

/// The line written to the CLI's standard input to ask `prompt` (stream-json input).
pub fn user_message(prompt: &str) -> String {
    let message = serde_json::json!({ "type": "user", "message": { "role": "user", "content": prompt } });
    format!("{message}\n")
}

/// Starts the CLI in `cwd`. It waits for `user_message` on standard input, so it can be started
/// ahead of the question to hide its start-up time.
pub fn spawn(bin: &Path, args: &[String], cwd: &Path) -> std::io::Result<Child> {
    Command::new(bin)
        .args(args)
        .current_dir(cwd)
        // Always the subscription login, never a stray API key from the environment.
        .env_remove("ANTHROPIC_API_KEY")
        .env_remove("ANTHROPIC_AUTH_TOKEN")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
}

pub fn find_claude() -> Option<PathBuf> {
    // Remember a hit, but keep looking after a miss so a fresh install is picked up.
    static FOUND: Mutex<Option<PathBuf>> = Mutex::new(None);
    let mut found = FOUND.lock().unwrap();
    if let Some(p) = found.as_ref().filter(|p| p.exists()) {
        return Some(p.clone());
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("{home}/.local/bin/claude"),
        format!("{home}/.claude/local/claude"),
        "/opt/homebrew/bin/claude".to_string(),
        "/usr/local/bin/claude".to_string(),
    ];
    *found = candidates.iter().map(PathBuf::from).find(|p| p.exists()).or_else(|| {
        // Apps launched from Finder do not inherit the shell's PATH; ask a login shell.
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let out = Command::new(shell).args(["-ilc", "command -v claude"]).stdin(Stdio::null()).output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout);
        let path = PathBuf::from(text.lines().last()?.trim());
        path.exists().then_some(path)
    });
    found.clone()
}

/// What the installed CLI can do: its version and any required flag it lacks.
#[derive(Debug, Clone, PartialEq)]
pub struct Capabilities {
    pub version: String,
    pub missing: Vec<&'static str>,
}

/// `claude --version` prints "2.1.332 (Claude Code)".
pub fn parse_version(output: &str) -> Option<String> {
    let first = output.split_whitespace().next()?;
    first.chars().next()?.is_ascii_digit().then(|| first.to_string())
}

pub fn missing_flags(help: &str) -> Vec<&'static str> {
    REQUIRED_FLAGS.iter().copied().filter(|flag| !help.split(|c: char| c.is_whitespace() || c == ',').any(|word| word == *flag)).collect()
}

/// The binary as it is on disk now. `claude update` replaces the file (or the link's target), so
/// a change of path or modification time means the CLI must be checked again.
fn fingerprint(bin: &Path) -> (PathBuf, Option<SystemTime>) {
    let resolved = bin.canonicalize().unwrap_or_else(|_| bin.to_path_buf());
    let modified = std::fs::metadata(&resolved).and_then(|m| m.modified()).ok();
    (resolved, modified)
}

/// Checks the CLI at `bin`. `--version` and `--help` each cost a process, so the result is kept
/// until the binary changes on disk.
pub fn capabilities(bin: &Path) -> Capabilities {
    type Checked = Option<((PathBuf, Option<SystemTime>), Capabilities)>;
    static CHECKED: Mutex<Checked> = Mutex::new(None);
    let key = fingerprint(bin);
    if let Some((_, known)) = CHECKED.lock().unwrap().as_ref().filter(|(k, _)| *k == key) {
        return known.clone();
    }
    let run = |arg: &str| {
        Command::new(bin).arg(arg).stdin(Stdio::null()).output().map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default()
    };
    let version = parse_version(&run("--version")).unwrap_or_else(|| "unknown".into());
    let found = Capabilities { missing: missing_flags(&run("--help")), version };
    *CHECKED.lock().unwrap() = Some((key, found.clone()));
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "45a4908f-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

    fn read_only_block(tools: &str) -> Vec<String> {
        [
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--tools",
            tools,
            "--restricted",
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--permission-mode",
            "dontAsk",
        ]
        .map(String::from)
        .to_vec()
    }

    fn expected(tools: &str, tail: &[&str]) -> Vec<String> {
        read_only_block(tools).into_iter().chain(tail.iter().map(|s| s.to_string())).collect()
    }

    #[test]
    fn every_run_is_read_only_and_the_arguments_are_exactly_these() {
        let new = Session::New { id: ID.into(), system_prompt: "SYS".into() };
        assert_eq!(
            args("sonnet", Kind::Conversation, &new).unwrap(),
            expected("Read,Glob,Grep", &["--model", "sonnet", &format!("--session-id={ID}"), "--system-prompt=SYS"])
        );
        let resume = Session::Resume { id: ID.into(), system_prompt: "SYS".into() };
        assert_eq!(
            args("opus", Kind::Review, &resume).unwrap(),
            expected("Read,Glob,Grep", &["--model", "opus", &format!("--resume={ID}"), "--system-prompt=SYS"])
        );
        // Lookups are about the language and its libraries, not the folder: no tools at all.
        let lookup = Session::Ephemeral { system_prompt: "SYS".into() };
        assert_eq!(
            args("haiku", Kind::Lookup, &lookup).unwrap(),
            expected("", &["--model", "haiku", "--effort", "low", "--no-session-persistence", "--system-prompt=SYS"])
        );
        assert_eq!(READ_ONLY_TOOLS.join(","), "Read,Glob,Grep");
    }

    #[test]
    fn a_session_id_from_a_file_can_never_become_a_flag() {
        for bad in ["--settings=/tmp/hooks.json", "--mcp-config=x.json", "", "abc", &format!("{ID} --settings=x")] {
            for session in [
                Session::Resume { id: bad.to_string(), system_prompt: "s".into() },
                Session::New { id: bad.to_string(), system_prompt: "s".into() },
            ] {
                assert!(args("sonnet", Kind::Conversation, &session).is_err(), "{bad:?}");
            }
        }
        // A system prompt that looks like a flag stays the value of --system-prompt.
        let list = args("haiku", Kind::Lookup, &Session::Ephemeral { system_prompt: "--settings=x".into() }).unwrap();
        assert_eq!(list.last().unwrap(), "--system-prompt=--settings=x");
    }

    #[test]
    fn nothing_that_writes_or_runs_is_ever_named() {
        let all = [
            args("sonnet", Kind::Conversation, &Session::New { id: ID.into(), system_prompt: "s".into() }).unwrap(),
            args("haiku", Kind::Lookup, &Session::Ephemeral { system_prompt: "s".into() }).unwrap(),
            args("opus", Kind::Failure, &Session::Resume { id: ID.into(), system_prompt: "s".into() }).unwrap(),
        ];
        for list in all {
            for banned in ["Bash", "Edit", "Write", "WebFetch", "bypassPermissions", "--dangerously-skip-permissions", "--add-dir"] {
                assert!(!list.iter().any(|a| a.contains(banned)), "{banned} in {list:?}");
            }
        }
    }

    #[test]
    fn the_question_is_one_stream_json_line() {
        let line = user_message("what is \"softmax\"?\nthanks");
        assert!(line.ends_with('\n') && line.matches('\n').count() == 1);
        let parsed: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(parsed["type"], "user");
        assert_eq!(parsed["message"]["content"], "what is \"softmax\"?\nthanks");
    }

    #[test]
    fn versions_and_missing_flags_are_read_from_the_cli_output() {
        assert_eq!(parse_version("2.1.332 (Claude Code)\n").as_deref(), Some("2.1.332"));
        assert_eq!(parse_version("command not found"), None);
        let help = REQUIRED_FLAGS.iter().map(|f| format!("  {f} <value>  does a thing")).collect::<Vec<_>>().join("\n");
        assert!(missing_flags(&help).is_empty());
        let old = help.replace("--restricted", "--other").replace("--effort", "--efforts");
        assert_eq!(missing_flags(&old), vec!["--restricted", "--effort"]);
        // An option listed with an alias, as in "--allowedTools, --allowed-tools".
        assert!(!missing_flags("--tools, --tool-list").contains(&"--tools"));
    }

    #[test]
    fn the_cli_is_checked_once_until_it_changes_on_disk() {
        let dir = crate::workspace::tests::temp_dir("caps");
        let bin = dir.join("claude");
        let counter = dir.join("runs");
        std::fs::write(
            &bin,
            format!("#!/bin/sh\necho x >> '{}'\n[ \"$1\" = --version ] && echo '9.9.9 (Claude Code)'\nexit 0\n", counter.display()),
        )
        .unwrap();
        Command::new("chmod").args(["+x", bin.to_str().unwrap()]).status().unwrap();
        let runs = || std::fs::read_to_string(&counter).unwrap_or_default().lines().count();
        let first = capabilities(&bin);
        assert_eq!(first.version, "9.9.9");
        assert_eq!(runs(), 2, "--version and --help");
        assert_eq!(capabilities(&bin), first);
        assert_eq!(runs(), 2, "nothing runs while the binary is unchanged");
        // An update replaces the binary.
        std::thread::sleep(std::time::Duration::from_millis(20));
        let text = std::fs::read_to_string(&bin).unwrap().replace("9.9.9", "9.9.10");
        std::fs::write(&bin, text).unwrap();
        let modified = SystemTime::now() + std::time::Duration::from_secs(5);
        std::fs::File::options().write(true).open(&bin).unwrap().set_modified(modified).unwrap();
        assert_eq!(capabilities(&bin).version, "9.9.10");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
