//! Why a kernel's helper ended before the kernel was ready, when the helper could not say so
//! itself (it never ran: no uv, no Python, a project uv could not set up).

use serde_json::{json, Value};

fn problem(kind: &str, title: &str, detail: &str, fix: Option<&str>) -> Value {
    json!({ "kind": kind, "title": title, "detail": detail, "fix": fix })
}

/// The last few lines of `text`, for showing what went wrong in the program's own words.
fn last_lines(text: &str, count: usize) -> String {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty() && !l.contains("Kernel is running over TCP")).collect();
    lines[lines.len().saturating_sub(count)..].join("\n")
}

/// A problem the helper reported, with the end of what Python printed when the kernel itself
/// failed to start (an import error inside ipykernel, say), which the helper cannot see.
pub fn with_output(mut said: Value, stderr: &str) -> Value {
    let tail = last_lines(stderr, 4);
    if said["kind"] == "start-failed" && !tail.is_empty() {
        said["detail"] = json!(format!("{}. Python said:\n{tail}", said["detail"].as_str().unwrap_or_default().trim_end_matches('.')));
    }
    said
}

pub fn diagnose(uv: bool, code: Option<i32>, stderr: &str) -> Value {
    let not_found = code == Some(127) || stderr.contains("command not found");
    if uv && not_found {
        return problem(
            "no-uv",
            "uv is not installed",
            "This folder has a pyproject.toml, so its notebooks run in the project's environment through uv, which this Mac does not have (or which is not on the PATH of a login shell). Install it, then run the cell again.",
            Some("curl -LsSf https://astral.sh/uv/install.sh | sh"),
        );
    }
    if !uv && not_found {
        return problem(
            "no-python",
            "Python is not installed",
            "Notebooks run with python3, which this Mac does not have. Install Python 3 from python.org, then run the cell again.",
            None,
        );
    }
    let said = last_lines(stderr, 6);
    let detail = if said.is_empty() {
        format!("Python ended before the kernel was ready{}.", code.map(|c| format!(" (exit code {c})")).unwrap_or_default())
    } else {
        format!("Python ended before the kernel was ready. It said:\n{said}")
    };
    problem("failed", "Python could not start", &detail, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_what_is_missing() {
        assert_eq!(diagnose(true, Some(127), "zsh:1: command not found: uv")["kind"], "no-uv");
        assert_eq!(diagnose(false, Some(127), "sh: python3: command not found")["kind"], "no-python");
        let failed = diagnose(true, Some(2), "Resolved 3 packages\nerror: No `project` table found in pyproject.toml\n");
        assert_eq!(failed["kind"], "failed");
        assert!(failed["detail"].as_str().unwrap().contains("No `project` table"), "{failed}");
        assert_eq!(diagnose(false, Some(1), "")["detail"], "Python ended before the kernel was ready (exit code 1).");
    }

    #[test]
    fn a_kernel_that_fails_to_start_shows_what_python_said() {
        let said = json!({ "kind": "start-failed", "detail": "Kernel died before replying to kernel_info" });
        let shown = with_output(said, "Traceback\nImportError: incompatible architecture\n");
        assert_eq!(
            shown["detail"],
            "Kernel died before replying to kernel_info. Python said:\nTraceback\nImportError: incompatible architecture"
        );
        let missing = json!({ "kind": "no-ipykernel", "detail": "Install it." });
        assert_eq!(with_output(missing.clone(), "noise"), missing);
    }

    #[test]
    fn keeps_only_the_last_lines() {
        let text = (1..=20).map(|i| format!("line {i}")).collect::<Vec<_>>().join("\n");
        assert_eq!(last_lines(&text, 2), "line 19\nline 20");
    }
}
