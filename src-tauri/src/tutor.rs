//! The tutor runs through the user's own installed Claude Code, so it uses their
//! Claude subscription login. It is started with read-only tools and nothing else.

use crate::{log_event, read_config, workspace, AppState};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager, State};

const READ_ONLY_TOOLS: [&str; 3] = ["Read", "Glob", "Grep"];
const PROMPT_TEMPLATE: &str = include_str!("tutor-prompt.md");

const POLICY_STRICT: &str = "This workspace is on the strict policy: write no Python and no pseudocode at all. Use prose, math and shapes. Inline names of functions or variables are fine. Short non-code literals such as an error message or a shell command the student could run are fine.";
const POLICY_GUIDED: &str = "This workspace is on the guided policy: you may show short code only for (a) generic library usage on toy inputs unrelated to the task, or (b) a worked example on an analogous problem in a different setting. Keep any snippet under about ten lines.";

#[derive(Default)]
pub struct TutorState {
    session_id: Option<String>,
    started: bool,
    policy: String,
    pid: Option<i32>,
    generation: u64,
    cancelled: bool,
}

fn find_claude() -> Option<PathBuf> {
    static FOUND: OnceLock<Option<PathBuf>> = OnceLock::new();
    FOUND
        .get_or_init(|| {
            let home = std::env::var("HOME").unwrap_or_default();
            let candidates = [
                format!("{home}/.local/bin/claude"),
                format!("{home}/.claude/local/claude"),
                "/opt/homebrew/bin/claude".to_string(),
                "/usr/local/bin/claude".to_string(),
            ];
            if let Some(c) = candidates.iter().map(PathBuf::from).find(|p| p.exists()) {
                return Some(c);
            }
            // Apps launched from Finder do not inherit the shell's PATH; ask a login shell.
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
            let out = Command::new(shell).args(["-ilc", "command -v claude"]).stdin(Stdio::null()).output().ok()?;
            let text = String::from_utf8_lossy(&out.stdout);
            let path = PathBuf::from(text.lines().last()?.trim());
            path.exists().then_some(path)
        })
        .clone()
}

pub fn auth_status() -> Value {
    let Some(bin) = find_claude() else {
        return json!({ "installed": false, "loggedIn": false });
    };
    let parsed = Command::new(bin)
        .args(["auth", "status"])
        .stdin(Stdio::null())
        .output()
        .ok()
        .and_then(|o| serde_json::from_slice::<Value>(&o.stdout).ok());
    match parsed {
        Some(s) => json!({
            "installed": true,
            "loggedIn": s["loggedIn"] == true,
            "method": s["authMethod"],
            "plan": s["subscriptionType"],
        }),
        None => json!({ "installed": true, "loggedIn": false }),
    }
}

/// Course repositories (CS336 from 2026) ship an AGENTS.md / CLAUDE.md with rules for AI.
pub fn read_course_rules(ws: &Path) -> Option<(String, String)> {
    ["AGENTS.md", "CLAUDE.md"].iter().find_map(|name| {
        let text = std::fs::read_to_string(ws.join(name)).ok()?;
        if text.trim().is_empty() {
            return None;
        }
        let capped: String = text.chars().take(20_000).collect();
        Some((name.to_string(), capped))
    })
}

fn system_prompt(ws: &Path, policy: &str) -> String {
    let course = match read_course_rules(ws) {
        Some((name, text)) => format!(
            "## Course rules for AI\n\nThis workspace's {name} sets the course's rules for AI assistants. Follow them. Where they are stricter than anything above, they win.\n\n<course_rules>\n{text}\n</course_rules>"
        ),
        None => String::new(),
    };
    PROMPT_TEMPLATE
        .replace("{{POLICY}}", if policy == "guided" { POLICY_GUIDED } else { POLICY_STRICT })
        .replace("{{COURSE_RULES}}", &course)
}

pub fn cancel(state: &AppState) {
    let mut t = state.tutor.lock().unwrap();
    if let Some(pid) = t.pid.take() {
        t.cancelled = true;
        unsafe { libc::kill(pid, libc::SIGTERM) };
    }
}

pub fn reset(state: &AppState) {
    cancel(state);
    let mut t = state.tutor.lock().unwrap();
    t.session_id = None;
    t.started = false;
}

fn emit(app: &AppHandle, generation: u64, mut event: Value) {
    event["gen"] = json!(generation);
    let _ = app.emit("tutor:event", event);
}

#[tauri::command]
pub fn tutor_ask(app: AppHandle, state: State<AppState>, prompt: String, kind: String) -> Result<u64, String> {
    let ws = workspace(&state)?;
    let bin = find_claude().ok_or("Claude Code is not installed. Install it, then run `claude` once in the terminal to log in.")?;
    let cfg = read_config(&ws);
    let policy = cfg["policy"].as_str().unwrap_or("strict").to_string();
    let model = cfg["model"].as_str().unwrap_or("sonnet").to_string();
    log_event(&ws, "ask", json!({ "kind": kind, "chars": prompt.chars().count() }));
    cancel(&state);

    let mut args: Vec<String> = [
        "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
        "--tools", &READ_ONLY_TOOLS.join(","),
        "--restricted", "--strict-mcp-config", "--disable-slash-commands",
        "--permission-mode", "dontAsk",
        "--model", &model,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();

    let generation = {
        let mut t = state.tutor.lock().unwrap();
        // The system prompt is fixed per conversation, so a policy change starts a new one.
        if t.started && t.policy != policy {
            t.started = false;
            t.session_id = None;
        }
        match (&t.session_id, t.started) {
            (Some(id), true) => args.extend(["--resume".to_string(), id.clone()]),
            _ => {
                let id = uuid::Uuid::new_v4().to_string();
                args.extend(["--session-id".to_string(), id.clone(), "--system-prompt".to_string(), system_prompt(&ws, &policy)]);
                t.session_id = Some(id);
                t.policy = policy;
            }
        }
        t.generation += 1;
        t.cancelled = false;
        t.generation
    };

    let mut child = Command::new(bin)
        .args(&args)
        .current_dir(&ws)
        // Always the subscription login, never a stray API key from the environment.
        .env_remove("ANTHROPIC_API_KEY")
        .env_remove("ANTHROPIC_AUTH_TOKEN")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    state.tutor.lock().unwrap().pid = Some(child.id() as i32);

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(prompt.as_bytes());
    }
    let mut stderr = child.stderr.take().unwrap();
    let stderr_reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });

    std::thread::spawn(move || {
        let stdout = BufReader::new(child.stdout.take().unwrap());
        let mut failure: Option<String> = None;
        let mut finished = false;
        for line in stdout.lines().map_while(Result::ok) {
            let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
            match msg["type"].as_str().unwrap_or("") {
                "system" if msg["subtype"] == "init" => {
                    // Defence in depth: stop if the harness offers anything beyond read tools.
                    let extra: Vec<&str> = msg["tools"]
                        .as_array()
                        .map(|a| a.iter().filter_map(|t| t.as_str()).filter(|t| !READ_ONLY_TOOLS.contains(t)).collect())
                        .unwrap_or_default();
                    if !extra.is_empty() {
                        failure = Some(format!("The tutor refused to start: unexpected tools were available ({}).", extra.join(", ")));
                        let _ = child.kill();
                        break;
                    }
                    app.state::<AppState>().tutor.lock().unwrap().started = true;
                }
                "stream_event" if msg["parent_tool_use_id"].is_null() => {
                    let ev = &msg["event"];
                    if ev["type"] == "content_block_delta" && ev["delta"]["type"] == "text_delta" {
                        emit(&app, generation, json!({ "type": "text", "text": ev["delta"]["text"] }));
                    } else if ev["type"] == "content_block_start" && ev["content_block"]["type"] == "text" {
                        emit(&app, generation, json!({ "type": "block" }));
                    }
                }
                "assistant" => {
                    for block in msg["message"]["content"].as_array().into_iter().flatten() {
                        if block["type"] == "tool_use" {
                            let input = &block["input"];
                            let target = ["file_path", "pattern", "path"].iter().find_map(|k| input[*k].as_str()).unwrap_or("");
                            emit(&app, generation, json!({ "type": "tool", "name": block["name"], "target": target }));
                        }
                    }
                }
                "rate_limit_event" => {
                    let w = &msg["rate_limit_info"]["unifiedWindows"];
                    emit(&app, generation, json!({ "type": "usage", "fiveHour": w["five_hour"]["utilization"], "sevenDay": w["seven_day"]["utilization"] }));
                }
                "result" => {
                    finished = true;
                    if msg["is_error"] == true {
                        failure = Some(msg["result"].as_str().unwrap_or("The tutor request failed.").to_string());
                    }
                }
                _ => {}
            }
        }
        let status = child.wait().ok();
        let stderr_text = stderr_reader.join().unwrap_or_default();
        let state = app.state::<AppState>();
        let cancelled = {
            let mut t = state.tutor.lock().unwrap();
            if t.generation != generation {
                return; // a newer question replaced this one
            }
            t.pid = None;
            if !t.started || stderr_text.contains("No conversation found") {
                t.session_id = None;
                t.started = false;
            }
            t.cancelled
        };
        if cancelled {
            emit(&app, generation, json!({ "type": "done", "cancelled": true }));
        } else if let Some(message) = failure {
            emit(&app, generation, json!({ "type": "error", "message": message }));
        } else if !finished || !status.map(|s| s.success()).unwrap_or(false) {
            let message = if stderr_text.trim().is_empty() { "The tutor stopped unexpectedly.".to_string() } else { stderr_text.trim().to_string() };
            emit(&app, generation, json!({ "type": "error", "message": message }));
        } else {
            emit(&app, generation, json!({ "type": "done" }));
        }
    });
    Ok(generation)
}

#[tauri::command]
pub fn tutor_cancel(state: State<AppState>) {
    cancel(&state);
}

#[tauri::command]
pub fn tutor_reset(state: State<AppState>) {
    reset(&state);
}
