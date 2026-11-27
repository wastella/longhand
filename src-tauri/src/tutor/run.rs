//! One request on one thread: starting the CLI, streaming its answer to the interface as
//! `tutor:event`s, and recording the result in the thread.

use super::cli::{self, Session};
use super::failure::{classify, Failure};
use super::prompt::{system_prompt, Kind};
use super::stream::{self, Event, Limit};
use super::threads::{self, Message};
use crate::workspace::AppState;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::Child;
use tauri::{AppHandle, Emitter, Manager};

/// Everything a run needs to know, fixed when the student asks.
#[derive(Clone)]
pub struct Job {
    pub ws: PathBuf,
    pub bin: PathBuf,
    pub thread: String,
    pub request: String,
    pub kind: Kind,
    pub model: String,
    pub policy: String,
    pub prompt: String,
    pub ephemeral: bool,
}

/// What one CLI process produced.
struct Outcome {
    text: String,
    /// The CLI got as far as starting the session, so it can be resumed later.
    started: bool,
    failure: Option<Failure>,
}

fn emit(app: &AppHandle, job: &Job, mut event: Value) {
    event["thread"] = json!(job.thread);
    event["request"] = json!(job.request);
    let _ = app.emit("tutor:event", event);
}

/// Starts the CLI for `job` (or uses `warm`, one started ahead of time), sends it the question
/// with `preamble` before it, and records its process so it can be stopped.
pub fn launch(app: &AppHandle, job: &Job, session: &Session, preamble: Option<String>, warm: Option<Child>) -> Result<Child, Failure> {
    let mut child = match warm {
        Some(child) => child,
        None => cli::spawn(&job.bin, &cli::args(&job.model, job.kind.effort(), session), &job.ws)
            .map_err(|e| Failure::new("failed", format!("Could not start Claude Code: {e}")))?,
    };
    if !super::set_pid(&app.state::<AppState>(), job, child.id()) {
        let _ = child.kill();
        return Err(Failure::new("stopped", "Stopped."));
    }
    let prompt = match preamble {
        Some(text) => format!("{text}\n\n{}", job.prompt),
        None => job.prompt.clone(),
    };
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(cli::user_message(&prompt).as_bytes());
    }
    Ok(child)
}

/// Follows `child` to the end on a background thread, retrying once in a fresh session if the
/// CLI no longer has the one being resumed.
pub fn follow(app: AppHandle, job: Job, mut session: Session, mut child: Child) {
    std::thread::spawn(move || {
        let send = |event: Value| emit(&app, &job, event);
        let mut outcome = drive(&mut child, &send);
        let missing = outcome.failure.as_ref().is_some_and(|f| f.code == "session-missing");
        if missing && matches!(session, Session::Resume { .. }) {
            session = Session::New { id: uuid::Uuid::new_v4().to_string(), system_prompt: system_prompt(&job.ws, &job.policy, job.kind) };
            let earlier = threads::load(&job.ws, &job.thread).map(|t| t.messages).unwrap_or_default();
            // The last message is the question being asked now.
            let preamble = threads::history(&earlier[..earlier.len().saturating_sub(1)]);
            match launch(&app, &job, &session, preamble, None) {
                Ok(mut fresh) => {
                    emit(&app, &job, json!({ "type": "restarted" }));
                    outcome = drive(&mut fresh, &send);
                }
                Err(failure) => outcome.failure = Some(failure),
            }
        }
        finish(&app, &job, &session, outcome);
    });
}

/// Reads `child`'s output to the end, passing answer text, tool use and usage to `send`.
fn drive(child: &mut Child, send: &dyn Fn(Value)) -> Outcome {
    let stdout = BufReader::new(child.stdout.take().expect("stdout is piped"));
    let mut stderr = child.stderr.take().expect("stderr is piped");
    let stderr_reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    let mut out = Outcome { text: String::new(), started: false, failure: None };
    let mut limit: Option<Limit> = None;
    let mut result: Option<(bool, String)> = None;
    'lines: for line in stdout.lines().map_while(Result::ok) {
        for event in stream::parse(&line) {
            match event {
                Event::Init { tools } => {
                    // Defence in depth: stop if the CLI offers anything beyond the read tools.
                    let extra = stream::unexpected_tools(&tools);
                    if !extra.is_empty() {
                        out.failure = Some(Failure::read_only(&extra));
                        let _ = child.kill();
                        break 'lines;
                    }
                    out.started = true;
                }
                Event::Block if !out.text.is_empty() && !out.text.ends_with("\n\n") => {
                    out.text.push_str("\n\n");
                    send(json!({ "type": "text", "text": "\n\n" }));
                }
                Event::Block => {}
                Event::Text(text) => {
                    out.text.push_str(&text);
                    send(json!({ "type": "text", "text": text }));
                }
                Event::Tool { name, target } => send(json!({ "type": "tool", "name": name, "target": target })),
                Event::Limit(l) => {
                    send(
                        json!({ "type": "usage", "status": l.status, "resetsAt": l.resets_at, "fiveHour": l.five_hour, "sevenDay": l.seven_day }),
                    );
                    limit = Some(l);
                }
                Event::Result { is_error, text } => result = Some((is_error, text)),
            }
        }
    }
    let succeeded = child.wait().map(|s| s.success()).unwrap_or(false);
    let stderr_text = stderr_reader.join().unwrap_or_default();
    if out.failure.is_none() {
        out.failure = match result {
            Some((false, _)) if succeeded => None,
            Some((_, text)) => Some(classify(&format!("{text}\n{stderr_text}"), limit.as_ref())),
            None => Some(classify(&stderr_text, limit.as_ref())),
        };
    }
    out
}

fn finish(app: &AppHandle, job: &Job, session: &Session, outcome: Outcome) {
    let stopped = super::end_run(&app.state::<AppState>(), job);
    if !job.ephemeral {
        let status = if stopped { Some("stopped") } else { outcome.failure.as_ref().map(|_| "error") };
        let missing = outcome.failure.as_ref().is_some_and(|f| f.code == "session-missing");
        let saved = threads::update(&job.ws, &job.thread, job.kind.name(), |t| {
            match session {
                Session::New { id, .. } if outcome.started => {
                    t.session = Some(id.clone());
                    t.policy = job.policy.clone();
                }
                _ if missing => t.session = None,
                _ => {}
            }
            if !outcome.text.is_empty() || status.is_some() {
                let at = chrono::Local::now().to_rfc3339();
                t.messages.push(Message {
                    role: "tutor".into(),
                    text: outcome.text.clone(),
                    at,
                    status: status.map(String::from),
                    ..Default::default()
                });
            }
        });
        if let Err(e) = saved {
            eprintln!("could not save tutor thread {}: {e}", job.thread);
        }
    }
    let event = match (&outcome.failure, stopped) {
        (_, true) => json!({ "type": "done", "cancelled": true }),
        (Some(failure), _) => {
            let mut event = serde_json::to_value(failure).unwrap_or_default();
            event["type"] = json!("error");
            event
        }
        (None, _) => json!({ "type": "done" }),
    };
    emit(app, job, event);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    const INIT: &str = r#"{"type":"system","subtype":"init","tools":["Glob","Grep","Read"]}"#;
    const BLOCK: &str =
        r#"{"type":"stream_event","parent_tool_use_id":null,"event":{"type":"content_block_start","content_block":{"type":"text"}}}"#;
    const OK: &str = r#"{"type":"result","is_error":false,"result":"done"}"#;

    fn text(t: &str) -> String {
        format!(
            r#"{{"type":"stream_event","parent_tool_use_id":null,"event":{{"type":"content_block_delta","delta":{{"type":"text_delta","text":"{t}"}}}}}}"#
        )
    }

    /// Runs a stand-in for the CLI that prints `lines`, then runs `then` in the shell.
    fn fake_cli(lines: &[String], then: &str) -> (Outcome, Vec<Value>, Duration) {
        let script = lines.iter().map(|l| format!("printf '%s\\n' '{l}'")).collect::<Vec<_>>().join("; ");
        let mut child = Command::new("sh")
            .args(["-c", &format!("{script}; {then}")])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let events = RefCell::new(vec![]);
        let start = Instant::now();
        let outcome = drive(&mut child, &|e| events.borrow_mut().push(e));
        (outcome, events.into_inner(), start.elapsed())
    }

    #[test]
    fn an_answer_streams_as_text_with_blocks_separated() {
        let (out, events, _) = fake_cli(&[INIT.into(), BLOCK.into(), text("One."), BLOCK.into(), text("Two."), OK.into()], "exit 0");
        assert!(out.started && out.failure.is_none());
        assert_eq!(out.text, "One.\n\nTwo.");
        let sent: String = events.iter().filter_map(|e| e["text"].as_str()).collect();
        assert_eq!(sent, out.text, "the interface receives exactly the recorded text");
    }

    #[test]
    fn tools_beyond_reading_stop_the_run_at_once() {
        let init = r#"{"type":"system","subtype":"init","tools":["Read","Bash"]}"#.to_string();
        let (out, events, elapsed) = fake_cli(&[init], &format!("sleep 5; printf '%s\\n' '{}'", text("leaked")));
        assert_eq!(out.failure.unwrap().code, "read-only");
        assert!(!out.started && out.text.is_empty() && events.is_empty());
        assert!(elapsed < Duration::from_secs(4), "the process was killed rather than waited for");
    }

    #[test]
    fn a_rejected_usage_limit_reports_when_it_resets() {
        let limit = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":1795756800}}"#.to_string();
        let result = r#"{"type":"result","is_error":true,"result":"You have hit your limit"}"#.to_string();
        let (out, events, _) = fake_cli(&[INIT.into(), limit, result], "exit 1");
        let failure = out.failure.unwrap();
        assert_eq!((failure.code, failure.resets_at), ("rate-limited", Some(1795756800)));
        assert_eq!(events[0]["type"], "usage");
    }

    #[test]
    fn a_missing_session_and_a_crash_are_told_apart() {
        let (out, _, _) = fake_cli(&[], "echo 'No conversation found with session ID: x' >&2; exit 1");
        assert_eq!(out.failure.unwrap().code, "session-missing");
        let (out, _, _) = fake_cli(&[INIT.into(), text("Half")], "echo 'Segmentation fault' >&2; exit 139");
        let failure = out.failure.unwrap();
        assert_eq!((failure.code, failure.message.as_str()), ("failed", "Segmentation fault"));
        assert_eq!(out.text, "Half");
    }
}
