//! Turns the reporter plugin's records (one JSON object per line, see plugin.py) into test
//! results, and into the progress updates the interface shows while a run is going.

use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

/// Longest text kept for one field of one test; a test that prints a whole tensor should not
/// stall the interface. The cut keeps the start and the end, where the useful parts are.
const FIELD_LIMIT: usize = 200_000;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "UPPERCASE")]
pub enum Status {
    Passed,
    Failed,
    Error,
    Skipped,
    Xfail,
    Xpass,
}

/// One line of a traceback: a frame (`path` set), or a note between chained exceptions.
#[derive(Serialize, Clone, Debug, Default)]
pub struct Frame {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    /// The path inside the open folder, when the file is there and can be opened.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rel: Option<String>,
    /// True for the student's own files, false for libraries and Python itself.
    pub own: bool,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub func: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub lines: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct Section {
    pub title: String,
    pub text: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct Test {
    /// pytest's node id, which stays the same from run to run.
    pub id: String,
    pub status: Status,
    /// Seconds, all phases together.
    pub duration: f64,
    /// The test's file, relative to the folder.
    pub path: String,
    /// The line the test is defined on, counting from 1.
    pub line: Option<u32>,
    /// What went wrong, or why it was skipped: the assertion and pytest's explanation.
    pub message: String,
    /// The whole failure as pytest prints it.
    pub detail: String,
    /// The phase that failed when it was not the test itself: "setup", "teardown" or "collect".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<&'static str>,
    pub frames: Vec<Frame>,
    /// The deepest frame in the student's own code, where to look first.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at: Option<Frame>,
    pub sections: Vec<Section>,
}

/// What changed, for the live view.
#[derive(Serialize, Debug)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Update {
    Started,
    Collected { total: usize },
    Running { id: String },
    Result { test: Test },
    CollectError { test: Test },
}

/// The phases of one test seen so far.
#[derive(Default)]
struct Pending {
    duration: f64,
    status: Option<Status>,
    failure: Option<(&'static str, Value)>,
    reason: String,
    sections: Vec<Section>,
}

pub struct Report {
    workspace: Vec<PathBuf>,
    pending: HashMap<String, Pending>,
    pub tests: Vec<Test>,
    pub errors: Vec<Test>,
    pub started: bool,
    pub total: Option<usize>,
}

impl Report {
    pub fn new(workspace: &Path) -> Self {
        // Tracebacks may name files through the folder's real path or the one it was opened by.
        let mut roots = vec![workspace.to_path_buf()];
        if let Ok(real) = workspace.canonicalize() {
            if real != workspace {
                roots.push(real);
            }
        }
        Report { workspace: roots, pending: HashMap::new(), tests: vec![], errors: vec![], started: false, total: None }
    }

    /// Takes one line of the report. Lines that are not records (a torn write) are ignored.
    pub fn apply(&mut self, line: &str) -> Option<Update> {
        let record: Value = serde_json::from_str(line).ok()?;
        let text = |key: &str| record[key].as_str().unwrap_or_default().to_string();
        match record["event"].as_str()? {
            "start" => {
                self.started = true;
                Some(Update::Started)
            }
            "collected" => {
                let total = record["count"].as_u64()? as usize;
                self.total = Some(total);
                Some(Update::Collected { total })
            }
            "begin" => Some(Update::Running { id: text("nodeid") }),
            "collect-error" => {
                let id = text("nodeid");
                let path = id.split("::").next().unwrap_or_default().to_string();
                let test = self.build(id, path, None, Status::Error, 0.0, Some(("collect", record)), String::new(), vec![]);
                self.errors.push(test.clone());
                Some(Update::CollectError { test })
            }
            "report" => self.phase(record),
            _ => None,
        }
    }

    fn phase(&mut self, record: Value) -> Option<Update> {
        let id = record["nodeid"].as_str()?.to_string();
        let when = record["when"].as_str().unwrap_or_default();
        let outcome = record["outcome"].as_str().unwrap_or_default();
        let xfail = record.get("wasxfail").is_some();
        let pending = self.pending.entry(id.clone()).or_default();
        pending.duration += record["duration"].as_f64().unwrap_or(0.0);
        pending.sections = sections(&record);
        let reason = record["reason"].as_str().or_else(|| record["wasxfail"].as_str()).unwrap_or_default();
        if !reason.is_empty() {
            pending.reason = reason.trim_start_matches("Skipped: ").to_string();
        }
        let status = match (when, outcome) {
            (_, "failed") if pending.status.is_none() || pending.status == Some(Status::Passed) => {
                let phase = match when {
                    "call" => "call",
                    "setup" => "setup",
                    _ => "teardown",
                };
                pending.failure = Some((phase, record.clone()));
                Some(if when == "call" { Status::Failed } else { Status::Error })
            }
            ("setup" | "call", "skipped") => Some(if xfail { Status::Xfail } else { Status::Skipped }),
            ("call", "passed") => Some(if xfail { Status::Xpass } else { Status::Passed }),
            _ => None,
        };
        if let Some(status) = status {
            pending.status = Some(status);
        }
        if when != "teardown" {
            return None;
        }
        let pending = self.pending.remove(&id)?;
        let path = record["path"].as_str().unwrap_or_default().to_string();
        let line = record["lineno"].as_u64().map(|n| n as u32 + 1);
        let test = self.build(
            id,
            path,
            line,
            pending.status.unwrap_or(Status::Passed),
            pending.duration,
            pending.failure,
            pending.reason,
            pending.sections,
        );
        self.tests.push(test.clone());
        Some(Update::Result { test })
    }

    #[allow(clippy::too_many_arguments)]
    fn build(
        &self,
        id: String,
        path: String,
        line: Option<u32>,
        status: Status,
        duration: f64,
        failure: Option<(&'static str, Value)>,
        reason: String,
        sections: Vec<Section>,
    ) -> Test {
        let mut test = Test {
            id,
            status,
            duration,
            path,
            line,
            message: reason,
            detail: String::new(),
            phase: None,
            frames: vec![],
            at: None,
            sections,
        };
        let Some((phase, record)) = failure else { return test };
        test.phase = (phase != "call").then_some(phase);
        test.detail = cap(record["longrepr"].as_str().unwrap_or_default());
        let mut frames: Vec<Frame> = record["frames"].as_array().map(|f| f.iter().map(raw_frame).collect()).unwrap_or_default();
        if frames.is_empty() {
            frames = frames_from_text(&test.detail);
        }
        for frame in &mut frames {
            if let Some(path) = &frame.path {
                (frame.rel, frame.own) = self.locate(path);
            }
        }
        let crash = record["crash"]["message"].as_str().unwrap_or_default();
        test.message = cap(&explanation(&frames).unwrap_or_else(|| crash.to_string()));
        test.at = frames.iter().rev().find(|f| f.own).cloned().map(|f| Frame { lines: vec![], ..f });
        test.frames = frames;
        test
    }

    /// Where a traceback path is inside the folder, and whether it is the student's own code.
    fn locate(&self, path: &str) -> (Option<String>, bool) {
        // Python names code that has no file "<frozen …>" or "<string>".
        if path.starts_with('<') {
            return (None, false);
        }
        let given = Path::new(path);
        for root in &self.workspace {
            let full = normalize(&if given.is_absolute() { given.to_path_buf() } else { root.join(given) });
            if let Ok(rel) = full.strip_prefix(root) {
                let own = rel.components().enumerate().all(|(i, c)| {
                    let name = c.as_os_str().to_string_lossy();
                    !(i == 0 && name.starts_with('.')) && name != "site-packages" && name != "dist-packages"
                });
                return (Some(rel.to_string_lossy().to_string()), own);
            }
        }
        (None, false)
    }
}

fn sections(record: &Value) -> Vec<Section> {
    let Some(list) = record["sections"].as_array() else { return vec![] };
    list.iter().filter_map(|pair| Some(Section { title: pair[0].as_str()?.to_string(), text: cap(pair[1].as_str()?) })).collect()
}

fn raw_frame(value: &Value) -> Frame {
    if let Some(note) = value["note"].as_str() {
        return Frame { note: Some(note.to_string()), ..Frame::default() };
    }
    Frame {
        path: value["path"].as_str().map(str::to_string),
        line: value["lineno"].as_u64().map(|n| n as u32),
        func: value["where"].as_str().unwrap_or_default().trim_start_matches("in ").to_string(),
        lines: value["lines"].as_array().map(|l| l.iter().filter_map(|s| s.as_str().map(str::to_string)).collect()).unwrap_or_default(),
        ..Frame::default()
    }
}

/// Reads frames out of pytest's short traceback text, for failures the plugin could only send
/// as text (collection errors). Anything that is not part of a frame becomes a note.
pub fn frames_from_text(text: &str) -> Vec<Frame> {
    static HEAD: OnceLock<Regex> = OnceLock::new();
    let head = HEAD.get_or_init(|| Regex::new(r"^(\S.*?):(\d+): in (.+)$").unwrap());
    let mut frames: Vec<Frame> = vec![];
    for line in text.lines() {
        if let Some(c) = head.captures(line) {
            frames.push(Frame { path: Some(c[1].to_string()), line: c[2].parse().ok(), func: c[3].to_string(), ..Frame::default() });
            continue;
        }
        let in_frame = line.starts_with(' ') || line.starts_with("E ");
        match frames.last_mut() {
            Some(frame) if frame.note.is_none() && in_frame => frame.lines.push(line.to_string()),
            Some(Frame { note: Some(note), .. }) => {
                note.push('\n');
                note.push_str(line);
            }
            _ if line.trim().is_empty() => {}
            _ => frames.push(Frame { note: Some(line.to_string()), ..Frame::default() }),
        }
    }
    for frame in &mut frames {
        if let Some(note) = &mut frame.note {
            *note = note.trim().to_string();
        }
    }
    frames.retain(|f| f.note.as_deref() != Some(""));
    frames
}

/// pytest's explanation of the failure: the `E` lines of the last frame, without the marker.
fn explanation(frames: &[Frame]) -> Option<String> {
    let last = frames.iter().rev().find(|f| f.note.is_none())?;
    let lines: Vec<&str> = last.lines.iter().filter_map(|l| l.strip_prefix('E')).map(|l| l.strip_prefix("   ").unwrap_or(l)).collect();
    (!lines.is_empty()).then(|| lines.join("\n").trim_end().to_string())
}

/// Resolves `.` and `..` without touching the disk (the file may be gone, or a symlink).
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

/// Shortens very long text, keeping its start and end.
pub fn cap(text: &str) -> String {
    if text.len() <= FIELD_LIMIT {
        return text.to_string();
    }
    let floor = |mut i: usize| {
        while !text.is_char_boundary(i) {
            i -= 1;
        }
        i
    };
    let head = floor(FIELD_LIMIT / 2);
    let tail = floor(text.len() - FIELD_LIMIT / 2);
    let omitted = text[head..tail].lines().count();
    format!("{}\n… {omitted} lines omitted …\n{}", &text[..head], &text[tail..])
}

/// One line in pytest's own words: "2 failed, 5 passed, 1 skipped in 0.42s".
pub fn summary(tests: &[Test], errors: usize, seconds: f64) -> String {
    let count = |status| tests.iter().filter(|t| t.status == status).count();
    let parts = [
        (count(Status::Failed), "failed"),
        (count(Status::Passed), "passed"),
        (count(Status::Skipped), "skipped"),
        (count(Status::Xfail), "xfailed"),
        (count(Status::Xpass), "xpassed"),
        (count(Status::Error) + errors, if count(Status::Error) + errors == 1 { "error" } else { "errors" }),
    ];
    let said: Vec<String> = parts.iter().filter(|(n, _)| *n > 0).map(|(n, word)| format!("{n} {word}")).collect();
    let said = if said.is_empty() { "no tests ran".to_string() } else { said.join(", ") };
    format!("{said} in {seconds:.2}s")
}

#[cfg(test)]
mod tests {
    use super::*;

    const RESULTS: &str = include_str!("fixtures/results.jsonl");
    const COLLECT_ERRORS: &str = include_str!("fixtures/collect-errors.jsonl");
    const NO_TESTS: &str = include_str!("fixtures/no-tests.jsonl");

    fn run(fixture: &str) -> (Report, Vec<Update>) {
        let mut report = Report::new(Path::new("/work/course"));
        let updates = fixture.lines().filter_map(|line| report.apply(line)).collect();
        (report, updates)
    }

    fn find<'a>(report: &'a Report, id: &str) -> &'a Test {
        report.tests.iter().find(|t| t.id == id).unwrap_or_else(|| panic!("no result for {id}"))
    }

    #[test]
    fn every_test_gets_one_result_in_order() {
        let (report, updates) = run(RESULTS);
        assert!(report.started);
        assert_eq!(report.total, Some(23));
        assert_eq!(report.tests.len(), 23);
        assert!(matches!(updates[0], Update::Started));
        assert!(matches!(updates[1], Update::Collected { total: 23 }));
        assert!(matches!(&updates[2], Update::Running { id } if id == "tests/test_basics.py::test_passes"));
        assert!(matches!(&updates[3], Update::Result { test } if test.status == Status::Passed));
    }

    #[test]
    fn passes_and_failures() {
        let (report, _) = run(RESULTS);
        let pass = find(&report, "tests/test_basics.py::test_passes");
        assert_eq!((pass.status, pass.line, pass.path.as_str()), (Status::Passed, Some(9), "tests/test_basics.py"));
        assert!(pass.frames.is_empty() && pass.message.is_empty());

        let fail = find(&report, "tests/test_basics.py::test_assertion");
        assert_eq!(fail.status, Status::Failed);
        assert_eq!(fail.phase, None);
        assert!(fail.message.starts_with("AssertionError: assert {'a': 1, 'b': 2} == {'a': 1, 'b': 3}"));
        assert!(fail.message.contains("Differing items:"), "keeps pytest's explanation");
        assert!(fail.detail.contains("assert data =="));
        assert_eq!(fail.at.as_ref().and_then(|f| f.rel.as_deref()), Some("tests/test_basics.py"));
        assert_eq!(fail.at.as_ref().and_then(|f| f.line), Some(15));
    }

    #[test]
    fn the_students_own_frames_are_marked() {
        let (report, _) = run(RESULTS);
        let nested = find(&report, "tests/test_basics.py::test_nested_own_code");
        let at = nested.at.as_ref().unwrap();
        assert_eq!((at.rel.as_deref(), at.line, at.func.as_str()), (Some("pkg/model.py"), Some(11), "check"));
        assert_eq!(nested.message, "ValueError: negative: -1");

        let library = find(&report, "tests/test_basics.py::test_in_library_and_own_code");
        let owners: Vec<bool> = library.frames.iter().map(|f| f.own).collect();
        assert_eq!(owners, [true, false, false, false]);
        assert_eq!(library.frames[1].rel, None);
        assert_eq!(library.at.as_ref().and_then(|f| f.line), Some(25), "points at the test, not into json");

        let todo = find(&report, "tests/test_basics.py::test_not_implemented");
        assert_eq!(todo.message, "NotImplementedError");
        assert_eq!(todo.at.as_ref().and_then(|f| f.rel.as_deref()), Some("pkg/model.py"));
    }

    #[test]
    fn setup_and_teardown_errors() {
        let (report, _) = run(RESULTS);
        let setup = find(&report, "tests/test_basics.py::test_setup_error");
        assert_eq!((setup.status, setup.phase), (Status::Error, Some("setup")));
        assert_eq!(setup.message, "RuntimeError: fixture exploded");
        let teardown = find(&report, "tests/test_basics.py::test_teardown_error");
        assert_eq!((teardown.status, teardown.phase), (Status::Error, Some("teardown")));
    }

    #[test]
    fn skips_and_expected_failures() {
        let (report, _) = run(RESULTS);
        let skipped = find(&report, "tests/test_basics.py::test_skipped");
        assert_eq!((skipped.status, skipped.message.as_str()), (Status::Skipped, "not yet"));
        let xfail = find(&report, "tests/test_basics.py::test_xfail");
        assert_eq!((xfail.status, xfail.message.as_str()), (Status::Xfail, "known bug"));
        assert_eq!(find(&report, "tests/test_basics.py::test_xpass").status, Status::Xpass);
    }

    #[test]
    fn parameterised_and_class_based_ids() {
        let (report, _) = run(RESULTS);
        for id in [
            "test_param[a b]",
            "test_param[\\xfc]",
            "test_param[x::y]",
            "test_param[[z]]",
            "test_param[-1.5]",
            "TestShapes::test_square[3]",
        ] {
            find(&report, &format!("tests/test_basics.py::{id}"));
        }
        assert_eq!(find(&report, "tests/test_basics.py::test_param[a b]").status, Status::Failed);
        assert_eq!(find(&report, "tests/test_basics.py::TestShapes::test_square[3]").message, "assert (3 * 3) == 4");
    }

    #[test]
    fn captured_output_and_undecodable_bytes() {
        let (report, _) = run(RESULTS);
        let printed = find(&report, "tests/test_basics.py::test_prints_then_fails");
        let titles: Vec<&str> = printed.sections.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, ["Captured stdout call", "Captured stderr call"]);
        assert_eq!(printed.sections[0].text, "hello from stdout\n");
        let bytes = find(&report, "tests/test_basics.py::test_non_utf8_output");
        assert_eq!(bytes.sections[0].text, "bytes: \u{fffd}\u{fffd} ok\n");
    }

    #[test]
    fn chained_exceptions_keep_their_note() {
        let (report, _) = run(RESULTS);
        let chained = find(&report, "tests/test_basics.py::test_chained");
        assert_eq!(chained.frames.len(), 3);
        assert!(chained.frames[1].note.as_deref().unwrap().starts_with("The above exception"));
        assert_eq!(chained.message, "ValueError: wrapped");
    }

    #[test]
    fn durations_add_up_the_phases() {
        let (report, _) = run(RESULTS);
        assert!(find(&report, "tests/test_slow.py::test_sleepy").duration > 0.3);
    }

    #[test]
    fn collection_errors_show_the_import_failure() {
        let (report, updates) = run(COLLECT_ERRORS);
        assert_eq!(report.errors.len(), 2);
        assert_eq!(updates.iter().filter(|u| matches!(u, Update::CollectError { .. })).count(), 2);
        let import = &report.errors[0];
        assert_eq!((import.id.as_str(), import.status, import.phase), ("tests/test_broken.py", Status::Error, Some("collect")));
        assert_eq!(import.message, "ModuleNotFoundError: No module named 'cs336_basics'");
        assert!(import.frames[0].note.as_deref().unwrap().starts_with("ImportError while importing test module"));
        let at = import.at.as_ref().unwrap();
        assert_eq!((at.rel.as_deref(), at.line), (Some("tests/test_broken.py"), Some(1)));

        let syntax = &report.errors[1];
        assert!(syntax.message.ends_with("SyntaxError: invalid syntax"));
        assert!(syntax.frames.iter().all(|f| !f.own), "only pytest's own frames");
    }

    #[test]
    fn an_empty_run() {
        let (report, _) = run(NO_TESTS);
        assert_eq!((report.started, report.total, report.tests.len()), (true, Some(0), 0));
    }

    #[test]
    fn ignores_torn_lines() {
        let mut report = Report::new(Path::new("/w"));
        assert!(report.apply("{\"event\": \"rep").is_none());
        assert!(report.apply("").is_none());
    }

    #[test]
    fn text_frames() {
        let frames = frames_from_text("Intro line\nHint: x\nTraceback:\na.py:3: in f\n    g()\nE   KeyError: 1\n");
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].note.as_deref(), Some("Intro line\nHint: x\nTraceback:"));
        assert_eq!((frames[1].path.as_deref(), frames[1].line, frames[1].lines.len()), (Some("a.py"), Some(3), 2));
    }

    #[test]
    fn locating_paths() {
        let report = Report::new(Path::new("/work/course"));
        assert_eq!(report.locate("pkg/m.py"), (Some("pkg/m.py".into()), true));
        assert_eq!(report.locate("/work/course/tests/t.py"), (Some("tests/t.py".into()), true));
        assert_eq!(report.locate("../../usr/lib/python3/json/x.py"), (None, false));
        assert_eq!(report.locate(".venv/lib/python3.12/site-packages/torch/nn.py").1, false);
        assert_eq!(report.locate("<frozen importlib._bootstrap>"), (None, false));
    }

    #[test]
    fn caps_long_text_at_a_character_boundary() {
        let long = "é".repeat(FIELD_LIMIT);
        let capped = cap(&long);
        assert!(capped.len() < long.len() && capped.contains("lines omitted"));
        assert_eq!(cap("short"), "short");
    }

    #[test]
    fn summaries() {
        let (report, _) = run(RESULTS);
        assert_eq!(summary(&report.tests, 0, 1.0), "9 failed, 9 passed, 1 skipped, 1 xfailed, 1 xpassed, 2 errors in 1.00s");
        assert_eq!(summary(&[], 1, 0.5), "1 error in 0.50s");
        assert_eq!(summary(&[], 0, 0.0), "no tests ran in 0.00s");
    }
}
