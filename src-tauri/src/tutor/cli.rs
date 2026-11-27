//! Finding the user's `claude` CLI, checking it can run the tutor safely, and the exact
//! arguments every tutor run starts with.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

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
    /// A conversation the CLI already has.
    Resume { id: String },
    /// A one-off answer the CLI does not keep (lookups).
    Ephemeral { system_prompt: String },
}

/// The arguments for one run. The first block is what makes the tutor read-only; the test below
/// pins it, so any change to it is a deliberate one.
pub fn args(model: &str, effort: Option<&str>, session: &Session) -> Vec<String> {
    let mut args: Vec<String> = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--tools",
        "Read,Glob,Grep",
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
    if let Some(effort) = effort {
        args.extend(["--effort".into(), effort.into()]);
    }
    match session {
        Session::New { id, system_prompt } => {
            args.extend(["--session-id".into(), id.clone(), "--system-prompt".into(), system_prompt.clone()])
        }
        Session::Resume { id } => args.extend(["--resume".into(), id.clone()]),
        Session::Ephemeral { system_prompt } => {
            args.extend(["--no-session-persistence".into(), "--system-prompt".into(), system_prompt.clone()])
        }
    }
    args
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

/// Checks the CLI at `bin`. The `--help` check runs once per version, since it costs a process.
pub fn capabilities(bin: &Path) -> Capabilities {
    static CHECKED: Mutex<Option<Capabilities>> = Mutex::new(None);
    let run = |arg: &str| {
        Command::new(bin).arg(arg).stdin(Stdio::null()).output().map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default()
    };
    let version = parse_version(&run("--version")).unwrap_or_else(|| "unknown".into());
    let mut checked = CHECKED.lock().unwrap();
    if let Some(known) = checked.as_ref().filter(|c| c.version == version) {
        return known.clone();
    }
    let found = Capabilities { missing: missing_flags(&run("--help")), version };
    *checked = Some(found.clone());
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    const READ_ONLY_BLOCK: [&str; 14] = [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--tools",
        "Read,Glob,Grep",
        "--restricted",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--permission-mode",
        "dontAsk",
    ];

    fn expected(tail: &[&str]) -> Vec<String> {
        READ_ONLY_BLOCK.iter().chain(tail).map(|s| s.to_string()).collect()
    }

    #[test]
    fn every_run_is_read_only_and_the_arguments_are_exactly_these() {
        let new = Session::New { id: "abc".into(), system_prompt: "SYS".into() };
        assert_eq!(args("sonnet", None, &new), expected(&["--model", "sonnet", "--session-id", "abc", "--system-prompt", "SYS"]));
        let resume = Session::Resume { id: "abc".into() };
        assert_eq!(args("opus", None, &resume), expected(&["--model", "opus", "--resume", "abc"]));
        let lookup = Session::Ephemeral { system_prompt: "SYS".into() };
        assert_eq!(
            args("haiku", Some("low"), &lookup),
            expected(&["--model", "haiku", "--effort", "low", "--no-session-persistence", "--system-prompt", "SYS"])
        );
        assert_eq!(READ_ONLY_TOOLS.join(","), "Read,Glob,Grep");
    }

    #[test]
    fn nothing_that_writes_or_runs_is_ever_named() {
        let all = [
            args("sonnet", None, &Session::New { id: "a".into(), system_prompt: "s".into() }),
            args("haiku", Some("low"), &Session::Ephemeral { system_prompt: "s".into() }),
            args("opus", None, &Session::Resume { id: "a".into() }),
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
}
