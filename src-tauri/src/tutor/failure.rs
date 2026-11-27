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

const SESSION_MISSING: [&str; 1] = ["no conversation found"];
const LOGGED_OUT: [&str; 7] =
    ["not logged in", "/login", "invalid api key", "oauth token", "authentication_error", "invalid bearer", "token has been revoked"];
const RATE_LIMITED: [&str; 5] = ["usage limit", "hit your limit", "limit reached", "rate_limit_error", "rate limit"];
const OFFLINE: [&str; 9] = [
    "connection error",
    "enotfound",
    "econnrefused",
    "econnreset",
    "etimedout",
    "eai_again",
    "unable to connect",
    "fetch failed",
    "network",
];
const BUSY: [&str; 2] = ["overloaded", "529"];

/// Sorts out a failed run from the CLI's error text (its result and standard error) and the
/// last usage-limit report it sent.
pub fn classify(text: &str, limit: Option<&Limit>) -> Failure {
    let lower = text.to_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| lower.contains(n));
    let rejected = limit.is_some_and(|l| l.status == "rejected");
    if has(&SESSION_MISSING) {
        Failure::new("session-missing", "The earlier conversation is no longer available.")
    } else if rejected || has(&RATE_LIMITED) {
        let resets_at = limit.and_then(|l| l.resets_at).or_else(|| reset_time_in(text));
        Failure { resets_at, ..Failure::new("rate-limited", "You have reached your Claude usage limit.") }
    } else if has(&LOGGED_OUT) {
        Failure::new("logged-out", "Claude Code is not logged in. Run `claude` in the terminal, log in, then try again.")
    } else if has(&OFFLINE) {
        Failure::new("offline", "Could not reach Claude. Check your internet connection, then try again.")
    } else if has(&BUSY) {
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
