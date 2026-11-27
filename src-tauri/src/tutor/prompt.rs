//! The tutor's system prompt: `tutor-prompt.md` with the folder's policy, the kind of thread and
//! the course's own rules for AI filled in.

use std::path::Path;

const TEMPLATE: &str = include_str!("../tutor-prompt.md");

const POLICY_STRICT: &str = "This workspace is on the strict policy: write no Python and no pseudocode at all. Use prose, math and shapes. Inline names of functions or variables are fine. Short non-code literals such as an error message or a shell command the student could run are fine.";
const POLICY_GUIDED: &str = "This workspace is on the guided policy: you may show short code only for (a) generic library usage on toy inputs unrelated to the task, or (b) a worked example on an analogous problem in a different setting. Keep any snippet under about ten lines.";

/// What a thread is for. It shapes the system prompt, which is fixed for the life of a session.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Kind {
    Conversation,
    Lookup,
    Review,
    Failure,
}

impl Kind {
    pub fn parse(name: &str) -> Option<Kind> {
        match name {
            "conversation" => Some(Kind::Conversation),
            "lookup" => Some(Kind::Lookup),
            "review" => Some(Kind::Review),
            "failure" => Some(Kind::Failure),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Kind::Conversation => "conversation",
            Kind::Lookup => "lookup",
            Kind::Review => "review",
            Kind::Failure => "failure",
        }
    }

    /// Lookups are tuned for speed: the fastest model, little deliberation, nothing kept.
    pub fn default_model(self, configured: &str) -> String {
        if self == Kind::Lookup {
            "haiku".into()
        } else {
            configured.into()
        }
    }
    pub fn effort(self) -> Option<&'static str> {
        (self == Kind::Lookup).then_some("low")
    }
    pub fn ephemeral_by_default(self) -> bool {
        self == Kind::Lookup
    }

    fn setting(self) -> &'static str {
        match self {
            Kind::Conversation => "This is the conversation in the editor's side panel, where the student asks whatever they like: lookups, concepts, debugging, reviews.",
            Kind::Lookup => "This question comes from the lookup bar. The student wants a quick fact while they keep writing, and your answer appears in a small popover that is dismissed afterwards. Answer directly in a few sentences. Do not ask anything back and do not offer follow-ups. Read files only when the question is about this folder. If it asks for code the student is supposed to write, say in one sentence that the lookup bar cannot help with that, and name the concept they could look up instead.",
            Kind::Review => "This thread is a note pinned to a piece of the student's code. Give observations tied to line numbers, one idea at a time, then stop; the student replies if they want more.",
            Kind::Failure => "This thread is attached to one failing test. Help the student find the cause themselves: what the test checks, what the output says, and the next thing to look at. Do not state the fix.",
        }
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

pub fn system_prompt(ws: &Path, policy: &str, kind: Kind) -> String {
    let course = match read_course_rules(ws) {
        Some((name, text)) => format!(
            "## Course rules for AI\n\nThis workspace's {name} sets the course's rules for AI assistants. Follow them. Where they are stricter than anything above, they win.\n\n<course_rules>\n{text}\n</course_rules>"
        ),
        None => String::new(),
    };
    TEMPLATE
        .replace("{{POLICY}}", if policy == "guided" { POLICY_GUIDED } else { POLICY_STRICT })
        .replace("{{SETTING}}", kind.setting())
        .replace("{{COURSE_RULES}}", &course)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::tests::temp_dir;

    #[test]
    fn the_prompt_carries_the_policy_the_setting_and_the_course_rules() {
        let ws = temp_dir("prompt");
        let strict = system_prompt(&ws, "strict", Kind::Conversation);
        assert!(strict.contains("strict policy") && !strict.contains("guided policy"));
        assert!(!strict.contains("{{") && !strict.contains("Course rules"));
        assert!(system_prompt(&ws, "guided", Kind::Lookup).contains("lookup bar"));
        std::fs::write(ws.join("AGENTS.md"), "Never write the student's code.").unwrap();
        let course = system_prompt(&ws, "strict", Kind::Review);
        assert!(course.contains("<course_rules>\nNever write the student's code.\n</course_rules>"));
        assert!(course.contains("pinned to a piece of the student's code"));
        std::fs::remove_dir_all(ws).unwrap();
    }

    #[test]
    fn lookups_are_quick_and_kept_nowhere() {
        let lookup = Kind::parse("lookup").unwrap();
        assert_eq!((lookup.default_model("opus"), lookup.effort(), lookup.ephemeral_by_default()), ("haiku".into(), Some("low"), true));
        let review = Kind::parse("review").unwrap();
        assert_eq!((review.default_model("opus"), review.effort(), review.ephemeral_by_default()), ("opus".into(), None, false));
        assert_eq!(Kind::parse("anything"), None);
        for kind in [Kind::Conversation, Kind::Lookup, Kind::Review, Kind::Failure] {
            assert_eq!(Kind::parse(kind.name()), Some(kind));
        }
    }
}
