//! The tutor runs through the user's own installed Claude Code, so it uses their Claude
//! subscription login. It is started with read-only tools and nothing else (`cli.rs`).
//!
//! Requests belong to threads the interface names: the side-panel conversation, a lookup, and
//! later one per margin note or failing test. Threads are independent: each runs its own CLI
//! process, can be stopped on its own, and (unless ephemeral) is kept in `.longhand/threads/`.

mod cli;
mod failure;
mod prompt;
mod record;
mod run;
mod stream;
mod threads;

use crate::workspace::{log_event, read_config, workspace, AppState};
use cli::Session;
use failure::Failure;
use prompt::{system_prompt, Kind};
use run::Job;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use tauri::{AppHandle, State};

pub use prompt::read_course_rules;

const MODELS: [&str; 3] = ["haiku", "sonnet", "opus"];
/// How long a CLI started ahead of a lookup waits for its question before it is stopped.
const WARM_FOR: Duration = Duration::from_secs(120);

#[derive(Default)]
pub struct TutorState {
    /// The run in progress on each thread.
    runs: HashMap<String, Run>,
    /// A CLI started ahead of the next lookup, so its start-up time is already spent.
    warm: Option<Warm>,
    warm_count: u64,
}

struct Run {
    request: String,
    pid: Option<u32>,
    cancelled: bool,
}

struct Warm {
    key: String,
    child: Child,
    id: u64,
}

fn kill(pid: u32) {
    unsafe { libc::kill(pid as i32, libc::SIGTERM) };
}

fn stop(mut child: Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Records the process for `job`. False when the request was stopped or replaced meanwhile.
fn set_pid(state: &AppState, job: &Job, pid: u32) -> bool {
    let mut t = state.tutor.lock().unwrap();
    match t.runs.get_mut(&job.thread) {
        Some(run) if run.request == job.request && !run.cancelled => {
            run.pid = Some(pid);
            true
        }
        _ => false,
    }
}

/// Forgets the run for `job`. True when it was stopped or replaced rather than finishing.
fn end_run(state: &AppState, job: &Job) -> bool {
    let mut t = state.tutor.lock().unwrap();
    match t.runs.get(&job.thread) {
        Some(run) if run.request == job.request => {
            let cancelled = run.cancelled;
            t.runs.remove(&job.thread);
            cancelled
        }
        _ => true,
    }
}

fn cancel_thread(t: &mut TutorState, thread: &str) {
    if let Some(run) = t.runs.get_mut(thread) {
        run.cancelled = true;
        if let Some(pid) = run.pid.take() {
            kill(pid);
        }
    }
}

/// Stops every run and the warm process (when the window closes).
pub fn cancel(state: &AppState) {
    let mut t = state.tutor.lock().unwrap();
    let threads: Vec<String> = t.runs.keys().cloned().collect();
    for thread in threads {
        cancel_thread(&mut t, &thread);
    }
    if let Some(warm) = t.warm.take() {
        stop(warm.child);
    }
}

/// Called when another folder opens: nothing from the old one may keep running.
pub fn reset(state: &AppState) {
    cancel(state);
}

pub fn read_auth() -> Value {
    let Some(bin) = cli::find_claude() else {
        return json!({ "installed": false, "loggedIn": false });
    };
    let caps = cli::capabilities(&bin);
    let parsed = Command::new(bin)
        .args(["auth", "status"])
        .stdin(Stdio::null())
        .output()
        .ok()
        .and_then(|o| serde_json::from_slice::<Value>(&o.stdout).ok());
    let mut auth = match parsed {
        Some(s) => json!({
            "installed": true,
            "loggedIn": s["loggedIn"] == true,
            "method": s["authMethod"],
            "plan": s["subscriptionType"],
        }),
        None => json!({ "installed": true, "loggedIn": false }),
    };
    auth["version"] = json!(caps.version);
    auth["tooOld"] = json!(!caps.missing.is_empty());
    auth["missing"] = json!(caps.missing);
    auth
}

/// The CLI, if it is installed and new enough.
fn usable_claude() -> Result<std::path::PathBuf, Failure> {
    let bin = cli::find_claude().ok_or_else(Failure::not_installed)?;
    let caps = cli::capabilities(&bin);
    if !caps.missing.is_empty() {
        return Err(Failure::too_old(&caps.version, &caps.missing));
    }
    Ok(bin)
}

/// A session that can be resumed: the CLI has it, and it was set up for the current policy
/// (the system prompt is fixed for the life of a session).
fn resumable<'a>(thread: &'a threads::Thread, policy: &str) -> Option<&'a str> {
    thread.session.as_deref().filter(|_| thread.policy == policy)
}

fn warm_key(ws: &Path, policy: &str, kind: Kind, model: &str) -> String {
    format!("{}|{policy}|{}|{model}", ws.display(), kind.name())
}

fn choose_model(requested: Option<&str>, kind: Kind, configured: &str) -> Result<String, Failure> {
    let model = requested.map(String::from).unwrap_or_else(|| kind.default_model(configured));
    if MODELS.contains(&model.as_str()) {
        Ok(model)
    } else {
        Err(Failure::new("invalid", format!("Unknown tutor model \"{model}\". Use haiku, sonnet or opus.")))
    }
}

#[derive(Deserialize)]
pub struct Request {
    /// Chosen by the caller; every event for this request carries it.
    id: String,
    thread: String,
    /// conversation, lookup, review or failure.
    kind: String,
    /// The full text sent to the model, context included.
    prompt: String,
    /// What the student wrote, as the transcript shows it. Defaults to `prompt`.
    question: Option<String>,
    /// Labels for what was attached, such as "stats/running.py, lines 3–9".
    context: Option<Vec<String>>,
    model: Option<String>,
    /// What the question was for, in the usage log: question, explain, review, failure, hint,
    /// lookup. Defaults to the kind.
    about: Option<String>,
    /// For hints: the rung of the ladder (1–3).
    rung: Option<u8>,
    /// Kept nowhere: no thread file and no CLI session. Defaults to true for lookups.
    ephemeral: Option<bool>,
    /// Asks the thread's last question again, so the transcript does not repeat it.
    retry: Option<bool>,
}

#[tauri::command]
pub async fn auth_status() -> Value {
    read_auth()
}

#[tauri::command]
pub fn tutor_request(app: AppHandle, state: State<AppState>, request: Request) -> Result<(), Failure> {
    let ws = workspace(&state).map_err(|e| Failure::new("no-folder", e))?;
    if !threads::valid_id(&request.thread) {
        return Err(Failure::new("invalid", "Thread ids may use only letters, digits, - and _."));
    }
    let kind = Kind::parse(&request.kind).ok_or_else(|| Failure::new("invalid", format!("Unknown request kind \"{}\".", request.kind)))?;
    let bin = usable_claude()?;
    let cfg = read_config(&ws);
    let policy = cfg["policy"].as_str().unwrap_or("strict").to_string();
    let model = choose_model(request.model.as_deref(), kind, cfg["model"].as_str().unwrap_or("sonnet"))?;
    let ephemeral = request.ephemeral.unwrap_or(kind.ephemeral_by_default());
    let about = request.about.clone().unwrap_or_else(|| if kind == Kind::Conversation { "question".into() } else { kind.name().into() });
    let mut entry = json!({ "about": about, "kind": kind.name(), "model": model, "chars": request.prompt.chars().count() });
    if let Some(rung) = request.rung {
        entry["rung"] = json!(rung);
    }
    log_event(&ws, "ask", entry);

    let job = Job {
        ws: ws.clone(),
        bin,
        thread: request.thread.clone(),
        request: request.id.clone(),
        kind,
        model,
        policy,
        prompt: request.prompt,
        ephemeral,
    };
    let (session, preamble) = if ephemeral {
        (Session::Ephemeral { system_prompt: system_prompt(&ws, &job.policy, kind) }, None)
    } else {
        let thread = threads::load(&ws, &job.thread).unwrap_or_default();
        match resumable(&thread, &job.policy) {
            Some(id) => (Session::Resume { id: id.to_string() }, None),
            None => (
                Session::New { id: uuid::Uuid::new_v4().to_string(), system_prompt: system_prompt(&ws, &job.policy, kind) },
                threads::history(&thread.messages),
            ),
        }
    };
    if !ephemeral && request.retry != Some(true) {
        let question = request.question.unwrap_or_else(|| job.prompt.clone());
        let context = request.context.unwrap_or_default();
        threads::update(&ws, &job.thread, kind.name(), |t| {
            let at = chrono::Local::now().to_rfc3339();
            t.messages.push(threads::Message { role: "student".into(), text: question, at, context, status: None });
        })
        .map_err(|e| Failure::new("failed", format!("Could not save the conversation in .longhand/threads: {e}")))?;
    }

    let warm = {
        let mut t = state.tutor.lock().unwrap();
        // A new question on a thread replaces the one in progress there.
        cancel_thread(&mut t, &job.thread);
        t.runs.insert(job.thread.clone(), Run { request: job.request.clone(), pid: None, cancelled: false });
        let key = warm_key(&ws, &job.policy, kind, &job.model);
        match t.warm.take() {
            // A warm process that has exited is useless; dropping it is enough.
            Some(mut w) if ephemeral && w.key == key => matches!(w.child.try_wait(), Ok(None)).then_some(w.child),
            other => {
                t.warm = other;
                None
            }
        }
    };
    let child = run::launch(&app, &job, &session, preamble, warm).inspect_err(|_| {
        state.tutor.lock().unwrap().runs.remove(&job.thread);
    })?;
    run::follow(app, job, session, child);
    Ok(())
}

/// Starts the CLI for the next ephemeral request of `kind` (a lookup) before it is asked, so the
/// answer starts sooner. Best effort: any problem surfaces when the request is made.
#[tauri::command]
pub fn tutor_prepare(app: AppHandle, state: State<AppState>, kind: String, model: Option<String>) {
    let (Ok(ws), Some(kind), Ok(bin)) = (workspace(&state), Kind::parse(&kind), usable_claude()) else { return };
    let cfg = read_config(&ws);
    let policy = cfg["policy"].as_str().unwrap_or("strict").to_string();
    let Ok(model) = choose_model(model.as_deref(), kind, cfg["model"].as_str().unwrap_or("sonnet")) else { return };
    let key = warm_key(&ws, &policy, kind, &model);
    let mut t = state.tutor.lock().unwrap();
    if let Some(w) = t.warm.as_mut().filter(|w| w.key == key) {
        if matches!(w.child.try_wait(), Ok(None)) {
            return;
        }
    }
    if let Some(old) = t.warm.take() {
        stop(old.child);
    }
    let session = Session::Ephemeral { system_prompt: system_prompt(&ws, &policy, kind) };
    let Ok(child) = cli::spawn(&bin, &cli::args(&model, kind.effort(), &session), &ws) else { return };
    t.warm_count += 1;
    let id = t.warm_count;
    t.warm = Some(Warm { key, child, id });
    expire_warm(app, id);
}

/// Stops a warm CLI nobody used. Called from a timer so an idle process does not linger.
fn expire_warm(app: AppHandle, id: u64) {
    std::thread::spawn(move || {
        std::thread::sleep(WARM_FOR);
        let state = tauri::Manager::state::<AppState>(&app);
        let mut t = state.tutor.lock().unwrap();
        if t.warm.as_ref().is_some_and(|w| w.id == id) {
            if let Some(w) = t.warm.take() {
                stop(w.child);
            }
        }
    });
}

/// Stops the request in progress on `thread` (only while it is still `request`, when given), or
/// on every thread when no thread is given.
#[tauri::command]
pub fn tutor_cancel(state: State<AppState>, thread: Option<String>, request: Option<String>) {
    let mut t = state.tutor.lock().unwrap();
    let targets: Vec<String> = match thread {
        Some(thread) => vec![thread],
        None => t.runs.keys().cloned().collect(),
    };
    for thread in targets {
        let current = t.runs.get(&thread).map(|run| run.request.clone());
        if request.is_none() || current == request {
            cancel_thread(&mut t, &thread);
        }
    }
}

/// The folder's kept threads whose id starts with `prefix`, most recently used first.
#[tauri::command]
pub fn tutor_threads(state: State<AppState>, prefix: String) -> Result<Vec<threads::Summary>, String> {
    Ok(threads::list(&workspace(&state)?, &prefix))
}

/// One kept thread with its transcript, or null.
#[tauri::command]
pub fn tutor_thread(state: State<AppState>, id: String) -> Result<Option<threads::Thread>, String> {
    Ok(threads::load(&workspace(&state)?, &id))
}

/// The student's tutor use in this folder, by day.
#[tauri::command]
pub fn tutor_record(state: State<AppState>) -> Result<record::Record, String> {
    let ws = workspace(&state)?;
    Ok(record::from_log(&std::fs::read_to_string(ws.join(".longhand/log.jsonl")).unwrap_or_default()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_resumes_only_under_the_policy_it_was_written_for() {
        let mut thread = threads::Thread { session: Some("s1".into()), policy: "strict".into(), ..Default::default() };
        assert_eq!(resumable(&thread, "strict"), Some("s1"));
        assert_eq!(resumable(&thread, "guided"), None);
        thread.session = None;
        assert_eq!(resumable(&thread, "strict"), None);
    }

    #[test]
    fn models_are_checked_and_lookups_default_to_the_fastest() {
        assert_eq!(choose_model(None, Kind::Lookup, "sonnet").unwrap(), "haiku");
        assert_eq!(choose_model(None, Kind::Conversation, "sonnet").unwrap(), "sonnet");
        assert_eq!(choose_model(Some("opus"), Kind::Lookup, "sonnet").unwrap(), "opus");
        assert_eq!(choose_model(Some("gpt"), Kind::Review, "sonnet").unwrap_err().code, "invalid");
    }

    #[test]
    fn a_warm_process_is_only_reused_for_the_same_folder_policy_kind_and_model() {
        let ws = Path::new("/w");
        let key = warm_key(ws, "strict", Kind::Lookup, "haiku");
        assert_eq!(key, warm_key(ws, "strict", Kind::Lookup, "haiku"));
        assert_ne!(key, warm_key(ws, "guided", Kind::Lookup, "haiku"));
        assert_ne!(key, warm_key(ws, "strict", Kind::Lookup, "sonnet"));
        assert_ne!(key, warm_key(Path::new("/x"), "strict", Kind::Lookup, "haiku"));
    }
}
