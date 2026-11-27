//! Why a tutor run failed, as a code the interface can act on and a sentence a student can
//! follow.

use super::stream::Limit;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Failure {
    /// not-installed, too-old, logged-out, rate-limited, offline, busy, read-only,
    /// session-missing (handled inside the backend), no-folder, invalid or failed.
    pub code: &'static str,
    pub message: String,
    /// For rate-limited: when the limit resets, in seconds since the epoch.
    #[serde(rename = "resetsAt", skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<i64>,
}

impl Failure {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Failure { code, message: message.into(), resets_at: None }
    }

    pub fn not_installed() -> Self {
        Self::new("not-installed", "Claude Code is not installed. Install it, then run `claude` once in the terminal to log in.")
    }

    pub fn too_old(version: &str, missing: &[&str]) -> Self {
        Self::new(
            "too-old",
            format!(
                "Claude Code {version} is too old for the tutor (it has no {}). Update it by running `claude update` in the terminal.",
                missing.join(", ")
            ),
        )
    }

    /// The CLI answered without first saying which tools it offers, so nothing it wrote is shown.
    pub fn unchecked_tools() -> Self {
        Self::new(
            "read-only",
            "The tutor stopped before answering because Claude Code did not report which tools it offers, so Longhand could not check that it is read-only. Updating Claude Code with `claude update` usually fixes this.",
        )
    }

    pub fn read_only(extra: &[String]) -> Self {
        Self::new(
            "read-only",
            format!(
                "The tutor stopped before answering because Claude Code offered it tools beyond reading files ({}). Longhand only runs the tutor read-only. Updating Claude Code with `claude update` usually fixes this.",
                extra.join(", ")
            ),
        )
    }
}

/// Patterns for the CLI's own error messages, matched line by line against error output only
/// (an error result and standard error, never the answer). Each names a whole phrase or error
/// code, so an answer that mentions "network" or "rate limit" can never look like a failure.
const SESSION_MISSING: &str = r"(?i)^(error: )?no conversation found with session id\b";
const LOGGED_OUT: &str = r"(?i)\bnot logged in\b|\bplease run /login\b|^(api error: )?invalid api key\b|\boauth token (has expired|has been revoked|is invalid)\b|\bauthentication_error\b|\binvalid bearer token\b";
const RATE_LIMITED: &str =
    r"(?i)\busage limit reached\b|\byou('ve| have) hit your (usage )?limit\b|\brate_limit_error\b|^(api error: )?429\b";
const OFFLINE: &str = r"(?i)^(api error: )?connection error\b|\bgetaddrinfo (enotfound|eai_again)\b|\b(connect )?(econnrefused|econnreset|etimedout)\b|^(typeerror: )?fetch failed\b|\bunable to connect to (the )?(anthropic )?api\b";
const BUSY: &str = r"(?i)^(api error: )?529\b|\boverloaded_error\b|^(api error: )?(529 )?overloaded\b";

fn matches(pattern: &str, lines: &[&str]) -> bool {
    let re = regex::Regex::new(pattern).expect("valid pattern");
    lines.iter().any(|line| re.is_match(line))
}

/// Sorts out a failed run from the CLI's error output (an error result and standard error, never
/// the answer) and the last usage-limit report it sent.
pub fn classify(text: &str, limit: Option<&Limit>) -> Failure {
    // Error output is short; a long text is not one to search.
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).take(40).collect();
    let has = |pattern: &str| matches(pattern, &lines);
    let rejected = limit.is_some_and(|l| l.status == "rejected");
    if has(SESSION_MISSING) {
        Failure::new("session-missing", "The earlier conversation is no longer available.")
    } else if rejected || has(RATE_LIMITED) {
        let resets_at = limit.and_then(|l| l.resets_at).or_else(|| reset_time_in(text));
        // Without a time to show, the CLI's own line carries when the limit resets.
        let message = match (resets_at, lines.iter().find(|l| regex::Regex::new(RATE_LIMITED).unwrap().is_match(l))) {
            (None, Some(line)) => format!("You have reached your Claude usage limit. Claude Code says: {}", line.replace('|', " ")),
            _ => "You have reached your Claude usage limit.".to_string(),
        };
        Failure { resets_at, ..Failure::new("rate-limited", message) }
    } else if has(LOGGED_OUT) {
        Failure::new("logged-out", "Claude Code is not logged in. Run `claude` in the terminal, log in, then try again.")
    } else if has(OFFLINE) {
        Failure::new("offline", "Could not reach Claude. Check your internet connection, then try again.")
    } else if has(BUSY) {
        Failure::new("busy", "Claude is overloaded right now. Try again in a minute.")
    } else {
        let first = text.trim().lines().next().unwrap_or("").chars().take(400).collect::<String>();
        Failure::new("failed", if first.is_empty() { "The tutor stopped unexpectedly.".to_string() } else { first })
    }
}

/// Older CLIs report a usage limit as "Claude AI usage limit reached|1795756800".
fn reset_time_in(text: &str) -> Option<i64> {
    text.split('|').nth(1)?.split_whitespace().next()?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_kind_of_failure_is_recognised() {
        let code = |text: &str| classify(text, None).code;
        assert_eq!(code("No conversation found with session ID: 4f0c"), "session-missing");
        assert_eq!(code("Invalid API key · Please run /login"), "logged-out");
        assert_eq!(code("OAuth token has expired. Please obtain a new token"), "logged-out");
        assert_eq!(code("API Error: Connection error."), "offline");
        assert_eq!(code("getaddrinfo ENOTFOUND api.anthropic.com"), "offline");
        assert_eq!(code("API Error: 529 Overloaded"), "busy");
        assert_eq!(code("Claude AI usage limit reached|1795756800"), "rate-limited");
        assert_eq!(code("You've hit your limit · resets 3pm"), "rate-limited");
        assert_eq!(code("Error: No conversation found with session ID: 4f0c"), "session-missing");
    }

    #[test]
    fn words_in_an_answer_are_not_errors() {
        let code = |text: &str| classify(text, None).code;
        for answer in [
            "A neural network learns its weights by gradient descent.",
            "Use a learning-rate schedule; the rate limit of the optimiser is not the issue.",
            "The 529 examples in the batch are overloaded with padding.",
            "If you hit a usage limit on the cluster, ask staff.",
            "The connection error in your test means the server fixture did not start.",
        ] {
            assert_eq!(code(answer), "failed", "{answer}");
        }
    }

    #[test]
    fn a_limit_without_a_time_keeps_what_the_cli_said() {
        let failure = classify("You've hit your limit · resets Dec 1, 3pm", None);
        assert_eq!(failure.resets_at, None);
        assert!(failure.message.ends_with("Claude Code says: You've hit your limit · resets Dec 1, 3pm"), "{}", failure.message);
        assert_eq!(classify("Claude AI usage limit reached|1795756800", None).message, "You have reached your Claude usage limit.");
    }

    #[test]
    fn a_usage_limit_says_when_it_resets() {
        assert_eq!(classify("Claude AI usage limit reached|1795756800", None).resets_at, Some(1795756800));
        let limit = Limit { status: "rejected".into(), resets_at: Some(1795759200), ..Default::default() };
        let failure = classify("", Some(&limit));
        assert_eq!((failure.code, failure.resets_at), ("rate-limited", Some(1795759200)));
        // An allowed limit does not turn an unrelated error into a usage limit.
        let fine = Limit { status: "allowed".into(), resets_at: Some(1), ..Default::default() };
        assert_eq!(classify("Something odd", Some(&fine)).code, "failed");
    }

    #[test]
    fn unknown_errors_keep_their_first_line_and_empty_ones_get_a_sentence() {
        assert_eq!(classify("Something odd\nstack trace", None).message, "Something odd");
        assert_eq!(classify("  ", None).message, "The tutor stopped unexpectedly.");
    }

    #[test]
    fn messages_for_setup_problems_say_what_to_run() {
        assert!(Failure::too_old("1.0.3", &["--restricted"]).message.contains("`claude update`"));
        assert!(Failure::read_only(&["Bash".into()]).message.contains("(Bash)"));
        let json = serde_json::to_value(Failure::not_installed()).unwrap();
        assert_eq!(json["code"], "not-installed");
        assert!(json.get("resetsAt").is_none());
    }
}
