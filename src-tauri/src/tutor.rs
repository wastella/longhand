//! The tutor runs through the user's own installed Claude Code, so it uses their Claude
//! subscription login. It is started with read-only tools and nothing else (`cli.rs`).
//!
//! Requests belong to threads the interface names: the side-panel conversation, the lookup bar,
//! and later one per margin note or failing test. Threads are independent: each runs its own CLI
//! process and can be stopped on its own. Within a thread requests take turns: a new one stops
//! the one running and waits until it has saved its answer. Unless ephemeral, a thread's
//! transcript is kept in `.longhand/threads/`.

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
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

pub use prompt::read_course_rules;

const MODELS: [&str; 3] = ["haiku", "sonnet", "opus"];
/// How long a CLI started ahead of a lookup waits for its question before it is stopped.
const WARM_FOR: Duration = Duration::from_secs(120);
/// How long a new request waits for a stopped run to exit before it is killed outright.
const STOP_GRACE: Duration = Duration::from_secs(3);

#[derive(Default)]
pub struct TutorState {
    /// The run in progress on each thread.
    runs: HashMap<String, Run>,
    /// Each thread's turn-taking: one request at a time (see `Slot`).
    gates: HashMap<String, Arc<Gate>>,
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

#[derive(Default)]
struct Gate {
    busy: Mutex<bool>,
    freed: Condvar,
}

/// A thread's turn. Holding it means no other request on the thread is running or saving; it is
/// given back when dropped, after the run has written its answer to the transcript.
pub struct Slot(Arc<Gate>);

impl Drop for Slot {
    fn drop(&mut self) {
        *self.0.busy.lock().unwrap() = false;
        self.0.freed.notify_all();
    }
}

/// Stops whatever runs on `thread` and waits for its turn there.
fn take_turn(state: &AppState, thread: &str) -> Slot {
    let gate = {
        let mut t = state.tutor.lock().unwrap();
        cancel_thread(&mut t, thread);
        t.gates.entry(thread.to_string()).or_default().clone()
    };
    let mut busy = gate.busy.lock().unwrap();
    while *busy {
        let (next, waited) = gate.freed.wait_timeout(busy, STOP_GRACE).unwrap();
        busy = next;
        if waited.timed_out() {
            // The stopped CLI ignored SIGTERM.
            if let Some(pid) = state.tutor.lock().unwrap().runs.get(thread).and_then(|r| r.pid) {
                unsafe { libc::kill(pid as i32, libc::SIGKILL) };
            }
        }
    }
    *busy = true;
    drop(busy);
    Slot(gate)
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
        if let Some(pid) = run.pid {
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

/// The folder's policy. `.longhand/config.json` may hold anything; only "guided" loosens it.
fn folder_policy(cfg: &Value) -> &'static str {
    if cfg["policy"] == "guided" {
        "guided"
    } else {
        "strict"
    }
}

/// A session that can be resumed: a well-formed id, set up under the current policy (the system
/// prompt is fixed for the life of a session), so a stored policy can never loosen the folder's.
fn resumable<'a>(thread: &'a threads::Thread, policy: &str) -> Option<&'a str> {
    thread.session.as_deref().filter(|id| thread.policy == policy && threads::valid_session(id))
}

/// A warm process can answer only a request it was started for, system prompt included (the
/// course's AGENTS.md may have changed since).
fn warm_key(ws: &Path, policy: &str, kind: Kind, model: &str, system_prompt: &str) -> String {
    format!("{}|{policy}|{}|{model}|{system_prompt}", ws.display(), kind.name())
}

fn choose_model(requested: Option<&str>, kind: Kind, configured: &str) -> Result<String, Failure> {
    let model = requested.map(String::from).unwrap_or_else(|| kind.default_model(configured));
    if MODELS.contains(&model.as_str()) {
        Ok(model)
    } else {
        Err(Failure::new("invalid", format!("Unknown tutor model \"{model}\". Use haiku, sonnet or opus.")))
    }
}

/// Logs one question as `kind: "ask"`, the shape every reader of the log counts (`record.rs`).
/// The request's own kind goes in `requestKind`; `about` is what the Record view groups by.
fn log_ask(ws: &Path, kind: Kind, about: Option<&str>, model: &str, chars: usize, rung: Option<u8>) {
    let about = about.map(String::from).unwrap_or_else(|| if kind == Kind::Conversation { "question".into() } else { kind.name().into() });
    let mut entry = json!({ "about": about, "requestKind": kind.name(), "model": model, "chars": chars });
    if let Some(rung) = rung {
        entry["rung"] = json!(rung);
    }
    log_event(ws, "ask", entry);
}

/// The title bar's counts for the folder: see `record::summary`.
pub fn log_summary(ws: &Path) -> Value {
    let text = std::fs::read_to_string(ws.join(".longhand/log.jsonl")).unwrap_or_default();
    record::summary(&text, chrono::Local::now().date_naive())
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
    /// Kept nowhere: no transcript and no CLI session. Lookups keep a transcript like any other
    /// thread but never a CLI session.
    ephemeral: Option<bool>,
    /// Asks the thread's last question again, so the transcript does not repeat it.
    retry: Option<bool>,
}

#[tauri::command]
pub async fn auth_status() -> Value {
    read_auth()
}

/// Starts a request. It runs off the main thread: it may wait for the thread's previous run to
/// stop and save, and checking the CLI costs a process the first time.
#[tauri::command]
pub async fn tutor_request(app: AppHandle, request: Request) -> Result<(), Failure> {
    tauri::async_runtime::spawn_blocking(move || start_request(&app, request))
        .await
        .map_err(|e| Failure::new("failed", format!("The tutor could not start: {e}")))?
}

fn start_request(app: &AppHandle, request: Request) -> Result<(), Failure> {
    let state = app.state::<AppState>();
    let ws = workspace(&state).map_err(|e| Failure::new("no-folder", e))?;
    if !threads::valid_id(&request.thread) {
        return Err(Failure::new("invalid", "Thread ids may use only letters, digits, - and _."));
    }
    let kind = Kind::parse(&request.kind).ok_or_else(|| Failure::new("invalid", format!("Unknown request kind \"{}\".", request.kind)))?;
    let bin = usable_claude()?;
    let cfg = read_config(&ws);
    let policy = folder_policy(&cfg);
    let model = choose_model(request.model.as_deref(), kind, cfg["model"].as_str().unwrap_or("sonnet"))?;
    let keep = !request.ephemeral.unwrap_or(false);
    log_ask(&ws, kind, request.about.as_deref(), &model, request.prompt.chars().count(), request.rung);

    // From here the thread is this request's: the run before it has stopped and saved its answer,
    // so the transcript stays in order and no two runs race over its session.
    let slot = take_turn(&state, &request.thread);
    let job = Job {
        ws: ws.clone(),
        bin,
        thread: request.thread.clone(),
        request: request.id.clone(),
        kind,
        model,
        policy: policy.to_string(),
        prompt: request.prompt,
        keep,
    };
    if keep && request.retry != Some(true) {
        let question = request.question.unwrap_or_else(|| job.prompt.clone());
        let context = request.context.unwrap_or_default();
        threads::update(&ws, &job.thread, kind.name(), |t| {
            let at = chrono::Local::now().to_rfc3339();
            t.messages.push(threads::Message { role: "student".into(), text: question, at, context, status: None });
        })
        .map_err(|e| Failure::new("failed", format!("Could not save the conversation in .longhand/threads: {e}")))?;
    }
    let system = system_prompt(&ws, policy, kind);
    let key = warm_key(&ws, policy, kind, &job.model, &system);
    let (session, preamble) = if !keep || !kind.keeps_session() {
        (Session::Ephemeral { system_prompt: system }, None)
    } else {
        let thread = threads::load(&ws, &job.thread).unwrap_or_default();
        match resumable(&thread, policy) {
            Some(id) => (Session::Resume { id: id.to_string(), system_prompt: system }, None),
            None => (
                Session::New { id: uuid::Uuid::new_v4().to_string(), system_prompt: system },
                threads::history(threads::before_last_question(&thread.messages)),
            ),
        }
    };

    let warm = {
        let mut t = state.tutor.lock().unwrap();
        t.runs.insert(job.thread.clone(), Run { request: job.request.clone(), pid: None, cancelled: false });
        match t.warm.take() {
            // A warm process that has exited is useless; dropping it is enough.
            Some(mut w) if matches!(session, Session::Ephemeral { .. }) && w.key == key => {
                matches!(w.child.try_wait(), Ok(None)).then_some(w.child)
            }
            other => {
                t.warm = other;
                None
            }
        }
    };
    let child = run::launch(app, &job, &session, preamble, warm).inspect_err(|_| {
        state.tutor.lock().unwrap().runs.remove(&job.thread);
    })?;
    run::follow(app.clone(), job, session, child, slot);
    Ok(())
}

/// Starts the CLI for the next request of `kind` (a lookup) before it is asked, so the answer
/// starts sooner. Best effort: any problem surfaces when the request is made.
#[tauri::command]
pub async fn tutor_prepare(app: AppHandle, kind: String, model: Option<String>) {
    let _ = tauri::async_runtime::spawn_blocking(move || prepare(&app, &kind, model.as_deref())).await;
}

fn prepare(app: &AppHandle, kind: &str, model: Option<&str>) {
    let state = app.state::<AppState>();
    let (Ok(ws), Some(kind), Ok(bin)) = (workspace(&state), Kind::parse(kind), usable_claude()) else { return };
    let cfg = read_config(&ws);
    let policy = folder_policy(&cfg);
    let Ok(model) = choose_model(model, kind, cfg["model"].as_str().unwrap_or("sonnet")) else { return };
    let system = system_prompt(&ws, policy, kind);
    let key = warm_key(&ws, policy, kind, &model, &system);
    let mut t = state.tutor.lock().unwrap();
    if let Some(w) = t.warm.as_mut().filter(|w| w.key == key) {
        if matches!(w.child.try_wait(), Ok(None)) {
            return;
        }
    }
    if let Some(old) = t.warm.take() {
        stop(old.child);
    }
    let session = Session::Ephemeral { system_prompt: system };
    let Ok(args) = cli::args(&model, kind, &session) else { return };
    let Ok(child) = cli::spawn(&bin, &args, &ws) else { return };
    t.warm_count += 1;
    let id = t.warm_count;
    t.warm = Some(Warm { key, child, id });
    expire_warm(app.clone(), id);
}

/// Stops a warm CLI nobody used. Called from a timer so an idle process does not linger.
fn expire_warm(app: AppHandle, id: u64) {
    std::thread::spawn(move || {
        std::thread::sleep(WARM_FOR);
        let state = app.state::<AppState>();
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

    const ID: &str = "45a4908f-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

    /// evals/run.mjs sends its prompts with exactly what the app would send, read from
    /// evals/config.json. This keeps that file in step with the code.
    #[test]
    fn the_eval_runner_uses_the_apps_configuration() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../evals");
        let fixture = root.join("fixture");
        let kinds = [Kind::Conversation, Kind::Lookup];
        let mut args = json!({});
        let mut prompts = json!({});
        for kind in kinds {
            let model = kind.default_model("sonnet");
            let session = Session::Ephemeral { system_prompt: "{{SYSTEM_PROMPT}}".into() };
            args[kind.name()] = json!(cli::args(&model, kind, &session).unwrap());
            for policy in ["strict", "guided"] {
                prompts[policy][kind.name()] = json!(system_prompt(&fixture, policy, kind));
            }
        }
        let config = json!({
            "about": "Generated by the eval-config test in src-tauri/src/tutor.rs. Run that test with LONGHAND_WRITE_EVAL_CONFIG=1 after changing the prompt or the CLI arguments.",
            "args": args,
            "systemPrompts": prompts,
        });
        let text = serde_json::to_string_pretty(&config).unwrap() + "\n";
        let path = root.join("config.json");
        if std::env::var_os("LONGHAND_WRITE_EVAL_CONFIG").is_some() {
            std::fs::write(&path, &text).unwrap();
        }
        // Compared as JSON, so reformatting the file (Prettier) does not matter.
        let saved: Value = std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        assert!(
            saved == config,
            "evals/config.json is out of date: run `LONGHAND_WRITE_EVAL_CONFIG=1 cargo test eval_runner` in src-tauri"
        );
    }

    #[test]
    fn a_session_resumes_only_under_the_policy_it_was_written_for() {
        let mut thread = threads::Thread { session: Some(ID.into()), policy: "strict".into(), ..Default::default() };
        assert_eq!(resumable(&thread, "strict"), Some(ID));
        assert_eq!(resumable(&thread, "guided"), None);
        thread.session = Some("--settings=/tmp/x".into());
        assert_eq!(resumable(&thread, "strict"), None, "even if a thread was built without load()");
        thread.session = None;
        assert_eq!(resumable(&thread, "strict"), None);
    }

    #[test]
    fn a_stored_policy_cannot_loosen_the_folders() {
        assert_eq!(folder_policy(&json!({ "policy": "guided" })), "guided");
        for loose in [json!({ "policy": "none" }), json!({ "policy": "Guided" }), json!({ "policy": 1 }), json!({})] {
            assert_eq!(folder_policy(&loose), "strict", "{loose}");
        }
        // A hostile thread file saying "guided" never resumes under a strict folder.
        let ws = crate::workspace::tests::temp_dir("loosen");
        std::fs::create_dir_all(ws.join(".longhand/threads")).unwrap();
        let file =
            format!(r#"{{"id":"conv-a","kind":"conversation","title":"","created":"","updated":"","policy":"guided","session":"{ID}"}}"#);
        std::fs::write(ws.join(".longhand/threads/conv-a.json"), file).unwrap();
        let thread = threads::load(&ws, "conv-a").unwrap();
        assert_eq!(resumable(&thread, "strict"), None);
        std::fs::remove_dir_all(ws).unwrap();
    }

    #[test]
    fn models_are_checked_and_lookups_default_to_the_fastest() {
        assert_eq!(choose_model(None, Kind::Lookup, "sonnet").unwrap(), "haiku");
        assert_eq!(choose_model(None, Kind::Conversation, "sonnet").unwrap(), "sonnet");
        assert_eq!(choose_model(Some("opus"), Kind::Lookup, "sonnet").unwrap(), "opus");
        assert_eq!(choose_model(Some("gpt"), Kind::Review, "sonnet").unwrap_err().code, "invalid");
        assert_eq!(choose_model(None, Kind::Review, "--settings=x").unwrap_err().code, "invalid");
    }

    #[test]
    fn a_warm_process_is_only_reused_for_the_same_folder_policy_kind_model_and_prompt() {
        let ws = Path::new("/w");
        let key = warm_key(ws, "strict", Kind::Lookup, "haiku", "P");
        assert_eq!(key, warm_key(ws, "strict", Kind::Lookup, "haiku", "P"));
        assert_ne!(key, warm_key(ws, "guided", Kind::Lookup, "haiku", "P"));
        assert_ne!(key, warm_key(ws, "strict", Kind::Lookup, "sonnet", "P"));
        assert_ne!(key, warm_key(Path::new("/x"), "strict", Kind::Lookup, "haiku", "P"));
        assert_ne!(key, warm_key(ws, "strict", Kind::Lookup, "haiku", "P with new course rules"));
    }

    #[test]
    fn every_kind_of_request_counts_in_the_title_bar_and_the_record() {
        let ws = crate::workspace::tests::temp_dir("asks");
        log_ask(&ws, Kind::Conversation, None, "sonnet", 10, None);
        log_ask(&ws, Kind::Conversation, Some("hint"), "sonnet", 10, Some(2));
        log_ask(&ws, Kind::Lookup, Some("lookup"), "haiku", 10, None);
        log_ask(&ws, Kind::Review, None, "sonnet", 10, None);
        log_ask(&ws, Kind::Failure, None, "sonnet", 10, None);
        log_event(&ws, "reveal", json!({ "lines": 3 }));
        // A detail that names a kind cannot change what the entry counts as.
        log_event(&ws, "config", json!({ "kind": "ask", "policy": "strict" }));
        let text = std::fs::read_to_string(ws.join(".longhand/log.jsonl")).unwrap();
        assert_eq!(text.lines().filter(|l| l.contains(r#""kind":"ask""#)).count(), 5, "{text}");
        assert!(text.contains(r#""requestKind":"lookup""#));

        let summary = log_summary(&ws);
        assert_eq!(summary["today"], json!({ "ask": 5, "reveal": 1, "tests": 0 }));
        let record = record::from_log(&text);
        let today = &record.days[0].tally;
        let expected = [("failure", 1), ("hint", 1), ("lookup", 1), ("question", 1), ("review", 1)];
        assert_eq!(today.asks, expected.iter().map(|(k, n)| (k.to_string(), *n)).collect());
        assert_eq!(today.asks.values().sum::<u32>(), 5, "the record's Today is the title bar's");
        std::fs::remove_dir_all(ws).unwrap();
    }

    #[test]
    fn requests_on_a_thread_take_turns_and_a_new_one_stops_the_old() {
        let state = Arc::new(AppState::default());
        let first = take_turn(&state, "conv-a");
        state.tutor.lock().unwrap().runs.insert("conv-a".into(), Run { request: "r1".into(), pid: None, cancelled: false });
        let order = Arc::new(Mutex::new(vec![]));
        let waiter = {
            let (state, order) = (state.clone(), order.clone());
            std::thread::spawn(move || {
                let _second = take_turn(&state, "conv-a");
                order.lock().unwrap().push("second runs");
            })
        };
        std::thread::sleep(Duration::from_millis(100));
        assert!(state.tutor.lock().unwrap().runs["conv-a"].cancelled, "the new request stopped the old run");
        // Another thread is not held up.
        drop(take_turn(&state, "conv-b"));
        order.lock().unwrap().push("first saves its answer");
        drop(first);
        waiter.join().unwrap();
        assert_eq!(*order.lock().unwrap(), ["first saves its answer", "second runs"]);
    }
}
