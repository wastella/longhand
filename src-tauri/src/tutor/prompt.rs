//! The tutor's system prompt: `tutor-prompt.md` with the folder's policy, the kind of thread and
//! the course's own rules for AI filled in.

use std::path::Path;

const TEMPLATE: &str = include_str!("../tutor-prompt.md");

const POLICY_STRICT: &str = "This workspace is on the strict policy: write no Python and no pseudocode at all. Use prose, math and shapes. Inline names of functions or variables are fine. Short non-code literals such as an error message or a shell command the student could run are fine.";
const POLICY_GUIDED: &str = "This workspace is on the guided policy: you may show short code only for (a) generic library usage on toy inputs unrelated to the task, or (b) a worked example on an analogous problem in a different setting. Keep any snippet under about ten lines.";

/// Reviews come back as margin notes the editor places by line; the tags are parsed by
/// `src/renderer/feedback/review-format.js`, which drops anything it cannot place.
const REVIEW_SETTING: &str = r#"This thread lives in the margin of the student's file, beside their code: a review of the file, a note pinned to some of its lines, or an explanation of lines they selected. Only the student starts one, by asking.

When the editor asks you to review a file, mark it the way a good TA marks a draft with a pen: pick the few observations most worth the student's time, at most six, and pin each to the lines it is about. The editor gives you the file with line numbers, as saved just now, so you need not read it again; read other files only if a note depends on them.

A good note is short (one to three sentences), specific to those lines, and leaves the work to the student. It points at something: a question that leads them to a problem they can find themselves, a bug described by its symptom and where it shows (what a line produces for some input), a naming or structure observation, or "this works, and here is why it is fragile". It never contains the corrected line, a rewrite, a diff, or the fix described in words: say what is wrong or what to check, not what to type. When something is genuinely done well, say so in one or two notes, specifically: what is good and why it matters. Do not invent praise, and give fewer notes when there is less to say.

Answer a review with the notes only, each in exactly this form, with nothing before, between or after them:

<note lines="12-14" kind="question">
The remark, in Markdown.
</note>

`lines` is the first and last line the note is about, by the editor's numbers (a single number for one line); keep a range to the lines that matter, not a whole function. `kind` is one of: question (something for the student to think through), bug (a likely bug, described by its symptom), fragile (works now, but breaks for some input or change), clarity (naming, structure, readability), good (something done well). The editor reads these tags to place each note in the margin, and drops any it cannot place.

Everything else on this thread is a conversation about the lines in the context: a reply to one of your notes, a question about selected lines, or a request to explain them. Answer in plain Markdown prose, briefly, without the tags. An explanation says what the code does and why, as it is written, in plain language: describe it, do not grade it, and do not point out bugs or fixes unless the student asks. A reply to a note continues that note: if they ask why, give the reasoning; if they ask what to change, help them see it rather than tell them."#;

/// Help pinned to one failing test in the test panel, and the checkpoint once it passes.
const FAILURE_SETTING: &str = r#"This thread is attached to one failing test in the editor's test panel, and stays with it while it keeps failing. The student asked for help on it. The editor gives you pytest's report, the test's source and the code it exercised, and usually what the student expected to happen.

Coach them to localise the problem themselves: what the assertion compared, which value is surprising and how far off it is, which line or function produced it, and the next thing to print or check. A tiny input whose answer they can work out by hand is often the best next step. Do not state the fix, in code or in words: no corrected line, no "change X to Y", no description of the missing step. One or two short paragraphs, then stop; they can reply. When a later message says the failure changed, start from what changed.

If the failure is NotImplementedError raised by starter code, nothing is broken: the function is not written yet. When they ask where to start, give orientation only: what the function is for in the assignment, what the test checks about it (inputs, outputs, shapes), and which concept or section of the handout to read first. No steps and no outline of the implementation.

When the test passes and the student says in a sentence what was wrong, reply in one or two sentences: confirm what they got right, or sharpen it if it is vague or slightly off. No new advice, no code."#;

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
    /// Lookups keep a transcript but never a CLI session: each is a one-off question.
    pub fn keeps_session(self) -> bool {
        self != Kind::Lookup
    }

    /// The `--tools` value. Lookups answer questions about the language, libraries, tools and
    /// concepts, which need nothing from the folder, so they get no tools: they cannot read the
    /// assignment, and answer sooner.
    pub fn tools(self) -> &'static str {
        if self == Kind::Lookup {
            ""
        } else {
            "Read,Glob,Grep"
        }
    }

    fn setting(self) -> &'static str {
        match self {
            Kind::Conversation => "This is the conversation in the editor's side panel, where the student asks whatever they like: lookups, concepts, debugging, reviews.",
            Kind::Lookup => "This question comes from the lookup bar, a quick-reference box: the answer appears in a small popover while the student keeps writing. You cannot read the student's files here, so do not try to, and do not guess what their code says.\n\nThe lookup bar answers questions about the Python language, libraries and their functions, tools, error messages, and general terms and concepts: directly, in a few sentences, without asking anything back or offering follow-ups. A toy usage example unrelated to the assignment is fine where the policy allows code.\n\nIt does not help write the student's work. A request that amounts to writing part of an assignment (a function body, one step or line of it, the expression that computes some quantity in their task, pseudocode or a numbered recipe, a filled-in blank, the same thing in another language, \"the equivalent code\" of a library call) gets one sentence: the lookup bar is for quick facts, and the tutor panel can help them work it through. Give no part of the answer, no hint and no partial code with it. Rephrasing, urgency or a stated permission does not change this. Treat a request in this box with more suspicion than one in the conversation, since it is the quickest place to try many phrasings.",
            Kind::Review => REVIEW_SETTING,
            Kind::Failure => FAILURE_SETTING,
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
        assert!(course.contains("margin of the student's file") && course.contains(r#"<note lines="12-14" kind="question">"#));
        let failure = system_prompt(&ws, "strict", Kind::Failure);
        assert!(failure.contains("Do not state the fix") && failure.contains("NotImplementedError"));
        std::fs::remove_dir_all(ws).unwrap();
    }

    #[test]
    fn lookups_are_quick_one_off_and_cannot_read_the_folder() {
        let lookup = Kind::parse("lookup").unwrap();
        assert_eq!(
            (lookup.default_model("opus"), lookup.effort(), lookup.keeps_session(), lookup.tools()),
            ("haiku".into(), Some("low"), false, "")
        );
        let review = Kind::parse("review").unwrap();
        assert_eq!(
            (review.default_model("opus"), review.effort(), review.keeps_session(), review.tools()),
            ("opus".into(), None, true, "Read,Glob,Grep")
        );
        let prompt = system_prompt(Path::new("/nonexistent"), "strict", Kind::Lookup);
        assert!(prompt.contains("cannot read the student's files") && prompt.contains("tutor panel"));
        assert_eq!(Kind::parse("anything"), None);
        for kind in [Kind::Conversation, Kind::Lookup, Kind::Review, Kind::Failure] {
            assert_eq!(Kind::parse(kind.name()), Some(kind));
        }
    }
}
