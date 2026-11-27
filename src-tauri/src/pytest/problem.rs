//! Explains, in plain words, why a run produced no results, and what to do about it.

use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Debug, PartialEq)]
pub struct Problem {
    /// A stable name for the interface and tests: "no-uv", "no-pytest", "no-tests", …
    pub kind: &'static str,
    pub title: String,
    pub detail: String,
    /// A command that fixes it, for the student to run in the terminal.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<String>,
}

fn problem(kind: &'static str, title: &str, detail: &str, fix: Option<&str>) -> Option<Problem> {
    Some(Problem { kind, title: title.into(), detail: detail.into(), fix: fix.map(str::to_string) })
}

/// How the run went, as far as diagnosis needs to know.
pub struct Outcome<'a> {
    pub uses_uv: bool,
    pub code: Option<i32>,
    pub output: &'a str,
    /// The reporter plugin loaded, so pytest itself started.
    pub started: bool,
    pub collected: Option<usize>,
    pub errors: usize,
    /// The run asked for particular tests rather than all of them.
    pub targeted: bool,
}

pub fn diagnose(run: &Outcome) -> Option<Problem> {
    let said = |text: &str| run.output.contains(text);
    if run.code == Some(127) || said("command not found: uv") || said("uv: command not found") {
        return if run.uses_uv {
            problem(
                "no-uv",
                "uv is not installed",
                "This folder has a pyproject.toml, so its tests run with uv, which this Mac does not have (or which is not on the PATH of a login shell). Install it, then run the tests again.",
                Some("curl -LsSf https://astral.sh/uv/install.sh | sh"),
            )
        } else {
            problem(
                "no-python",
                "Python is not installed",
                "The tests run with python3, which this Mac does not have. Install Python 3 from python.org, then run the tests again.",
                None,
            )
        };
    }
    if !run.started {
        if said("Failed to spawn: `pytest`") {
            return problem(
                "no-pytest",
                "pytest is not installed in this project",
                "uv set up the project's environment, but pytest is not one of its dependencies. Add it, then run the tests again.",
                Some("uv add --dev pytest"),
            );
        }
        if said("No module named pytest") {
            return problem(
                "no-pytest",
                "pytest is not installed",
                "python3 has no pytest module. Install it, then run the tests again.",
                Some("python3 -m pip install pytest"),
            );
        }
        if said("Error importing plugin \"longhand_pytest\"") {
            return problem(
                "reporter",
                "Longhand could not follow this run",
                "Its pytest reporter did not load, probably because a shell profile replaces PYTHONPATH. Make the profile add to it instead (export PYTHONPATH=\"...:$PYTHONPATH\"), then run the tests again. You can still run them in the terminal.",
                None,
            );
        }
        if said("ImportError while loading conftest") {
            let detail = format!(
                "pytest imports conftest.py before it runs any test, and the import failed{}. The whole error is in the output.",
                last_error(run.output).map(|e| format!(": {e}")).unwrap_or_default()
            );
            return problem("conftest", "conftest.py could not be imported", &detail, None);
        }
    }
    if run.code == Some(4) {
        let reason = run.output.lines().find_map(|l| l.strip_prefix("ERROR: ")).unwrap_or("pytest did not accept the command");
        let detail = format!("{reason}. If a test or file was renamed or deleted, run all the tests to refresh the list.");
        return problem("usage", "pytest could not start this run", &detail, None);
    }
    if !run.started {
        return problem(
            "did-not-start",
            "The tests did not start",
            "Something went wrong before pytest could run. The output says what.",
            None,
        );
    }
    if run.collected == Some(0) && run.errors == 0 {
        return if run.targeted {
            problem(
                "no-tests",
                "No tests matched",
                "The tests you asked for were not found. If they were renamed or deleted, run all the tests to refresh the list.",
                None,
            )
        } else {
            problem(
                "no-tests",
                "No tests found",
                "pytest looks for files named test_*.py or *_test.py, and for functions in them whose names start with test.",
                None,
            )
        };
    }
    if run.code == Some(3) {
        return problem(
            "internal",
            "pytest stopped with an internal error",
            "This is usually a plugin or configuration problem. The output says what.",
            None,
        );
    }
    None
}

/// The last `E` line of a traceback: the exception itself.
fn last_error(output: &str) -> Option<&str> {
    output.lines().rev().find_map(|l| l.strip_prefix("E   ")).map(str::trim)
}

/// None when the folder looks like Python; otherwise a reason not to run pytest in it at all.
pub fn not_python(folder: &Path) -> Option<Problem> {
    const MARKERS: [&str; 8] =
        ["pyproject.toml", "uv.lock", "setup.py", "setup.cfg", "pytest.ini", "tox.ini", "conftest.py", "requirements.txt"];
    if MARKERS.iter().any(|m| folder.join(m).exists()) || has_python_files(folder, 3) {
        return None;
    }
    problem(
        "not-python",
        "This folder has no Python code",
        "The test panel runs Python tests with pytest, and there are no .py files here. Open the folder that holds your assignment (usually the one with pyproject.toml).",
        None,
    )
}

fn has_python_files(dir: &Path, depth: u32) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else { return false };
    entries.flatten().any(|entry| {
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        if path.is_dir() {
            depth > 1 && !name.starts_with('.') && name != "node_modules" && has_python_files(&path, depth - 1)
        } else {
            name.ends_with(".py")
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outcome(output: &str, code: i32, started: bool) -> Outcome<'_> {
        Outcome { uses_uv: true, code: Some(code), output, started, collected: None, errors: 0, targeted: false }
    }

    fn kind(run: &Outcome) -> Option<&'static str> {
        diagnose(run).map(|p| p.kind)
    }

    #[test]
    fn missing_tools() {
        let no_uv = include_str!("fixtures/no-uv.out");
        let found = diagnose(&outcome(no_uv, 127, false)).unwrap();
        assert_eq!(found.kind, "no-uv");
        assert!(found.fix.unwrap().contains("astral.sh/uv"));
        assert_eq!(kind(&Outcome { uses_uv: false, ..outcome("zsh:1: command not found: python3", 127, false) }), Some("no-python"));

        let uv = diagnose(&outcome(include_str!("fixtures/no-pytest-uv.out"), 2, false)).unwrap();
        assert_eq!((uv.kind, uv.fix.as_deref()), ("no-pytest", Some("uv add --dev pytest")));
        let python = diagnose(&Outcome { uses_uv: false, ..outcome(include_str!("fixtures/no-pytest-python.out"), 1, false) }).unwrap();
        assert_eq!(python.fix.as_deref(), Some("python3 -m pip install pytest"));
    }

    #[test]
    fn errors_before_any_test() {
        let conftest = diagnose(&outcome(include_str!("fixtures/conftest-error.out"), 4, false)).unwrap();
        assert_eq!(conftest.kind, "conftest");
        assert!(conftest.detail.contains("No module named 'missing_thing'"));

        let usage = diagnose(&outcome(include_str!("fixtures/usage-error.out"), 4, true)).unwrap();
        assert_eq!(usage.kind, "usage");
        assert!(usage.detail.starts_with("file or directory not found: nope.py."));

        let reporter = "ImportError: Error importing plugin \"longhand_pytest\": No module named 'longhand_pytest'";
        assert_eq!(kind(&outcome(reporter, 1, false)), Some("reporter"));
        assert_eq!(kind(&outcome("error: Failed to build `torch`", 1, false)), Some("did-not-start"));
        assert_eq!(kind(&outcome("INTERNALERROR> boom", 3, true)), Some("internal"));
    }

    #[test]
    fn empty_runs() {
        let empty = Outcome { collected: Some(0), ..outcome("no tests ran", 5, true) };
        assert_eq!(diagnose(&empty).unwrap().title, "No tests found");
        assert_eq!(diagnose(&Outcome { targeted: true, ..empty }).unwrap().title, "No tests matched");
        // A file that fails to import is shown as its own result, not as an empty run.
        assert_eq!(kind(&Outcome { collected: Some(0), errors: 1, ..outcome("", 2, true) }), None);
    }

    #[test]
    fn ordinary_runs_have_no_problem() {
        assert_eq!(kind(&Outcome { collected: Some(3), ..outcome("1 failed, 2 passed", 1, true) }), None);
        assert_eq!(kind(&Outcome { collected: Some(3), ..outcome("3 passed", 0, true) }), None);
    }

    #[test]
    fn recognises_python_folders() {
        let dir = std::env::temp_dir().join(format!("longhand-not-python-{}", std::process::id()));
        let nested = dir.join("src/pkg");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(dir.join("notes.txt"), "").unwrap();
        assert_eq!(not_python(&dir).map(|p| p.kind), Some("not-python"));
        std::fs::write(nested.join("model.py"), "").unwrap();
        assert_eq!(not_python(&dir), None);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
