# Existing products and prior art: learner-oriented AI assistance in coding tools (as of 26 Nov 2026)

Reading notes for the report writer:
- "Fetched" means I read the primary page. "Search snippet" means the claim comes from a search-result summary of that URL and was not opened; treat those as leads with lower confidence.
- Anything I only recall from training data and could not source in this session is in Gaps, not in Cited Findings.
- I ran about 30 tool calls. Coverage is strong on Claude Code output styles, CS50 Duck, CodeAid, 61A-Bot, ChatGPT Study Mode, and the 2026 guardrail studies. It is thin on Khanmigo, Georgia Tech, Cursor's official docs, Thonny/Mu/BlueJ internals, and Reddit reception.

## 1. Education-specific tools (CS50 Duck, Khanmigo, CodeHelp, CodeAid, 61A-Bot, Replit, JetBrains Academy)

### Takeaway
Course-deployed assistants all converge on the same recipe: a system prompt that forbids full solutions, plus one or more hard mechanisms layered on top (output filtering/retry, structured request forms, pseudo-code-only output, rate limits). The published evidence shows reduced help-seeking load and faster homework, but no deployment has demonstrated a learning gain, and prompt-only guardrails leak measurably (CS50 Duck emitted code blocks up to 25% of the time; CodeAid's "Help Write Code" produced an exact solution in 53% of analyzed cases).

### Cited Findings

**CS50 Duck / CS50.ai (Harvard)**
- Launched spring 2023. Built on the ChatGPT/OpenAI API; designed to ask more questions than it answers and to be "much less inclined to just give students answers outright or generate code for them" (Malan). Fetched. — [Harvard Gazette, 25 Sep 2026](https://news.harvard.edu/gazette/story/2026/09/taming-the-duck-for-starters/)
- Three guardrail layers: (1) prompt instructions (no outright answers, follow the academic honesty policy); (2) custom code that checks each response before the student sees it and rejects or retries responses that fail; (3) a "heart system" borrowed from video games that caps how many questions a student can ask per time period. The limit is still being tuned; no numbers published in the article. Fetched. — [Harvard Gazette, 25 Sep 2026](https://news.harvard.edu/gazette/story/2026/09/taming-the-duck-for-starters/)
- Leak rate: the Duck was told not to respond with blocks of code yet did so up to 25% of the time; Malan attributes it to non-determinism and training data from Stack Overflow/Reddit, and says it has improved. "LLMs aren't deterministic in the sense that they will always do exactly as you command." Fetched. — [Harvard Gazette, 25 Sep 2026](https://news.harvard.edu/gazette/story/2026/09/taming-the-duck-for-starters/)
- Heavy-use tail: some students asked on the order of 200 questions; Malan says he does not know the threshold for excessive use. Before the Duck, office-hour waits could reach an hour. Fetched. — [Harvard Gazette, 25 Sep 2026](https://news.harvard.edu/gazette/story/2026/09/taming-the-duck-for-starters/)
- Delivery: the Duck ships as both a VS Code extension and a standalone web app; sibling tools are "Explain Highlighted Code" (VS Code extension giving just-in-time explanations of a selection) and style50 (formatting suggestions). Backend is a CS50.ai web server relaying to GPT-4o on Azure. Search snippet. — [CS50.ai docs](https://cs50.readthedocs.io/cs50.ai/); [Liu et al. SIGCSE 2024 paper PDF](https://cs.harvard.edu/malan/publications/V1fp0567-liu.pdf)
- Policy context: CS50 treats use of AI software other than its own that suggests or completes answers or lines of code as academically dishonest unless a course allows it. Search snippet. — [CS50.ai docs](https://cs50.readthedocs.io/cs50.ai/)
- Papers: "Teaching CS50 with AI" (Liu, Zenke, Liu, Holmes, Thornton, Malan, 2024) and follow-up "Improving AI in CS50" (2025, human feedback). A companion CS50 paper names "instruction dilution" as the cause of system-prompt drift. Search snippet. — [Liu et al. 2024 PDF](https://cs.harvard.edu/malan/publications/V1fp0567-liu.pdf); [follow-up PDF](https://cs.harvard.edu/malan/publications/fp0627-liu.pdf); [Small Language Models for Curriculum-based Guidance, arXiv 2510.02347](https://arxiv.org/pdf/2510.02347)

**CodeAid (Kazemitabaar et al., CHI 2024, Univ. of Toronto)**
- Web client (React) + Node/Express/MongoDB server on OpenAI models. Five structured features, each with an output restriction: General Question (prose, inline code at most, no multi-line code); Question from Code; Help Fix Code (highlights incorrect lines with natural-language fix on hover, never shows fixed code); Explain Code (line by line); Help Write Code (sub-goals and pseudo-code). Fetched. — [arXiv 2401.11314v2](https://arxiv.org/html/2401.11314v2)
- Deployment: 12-week semester, second-year C/systems course, about 700 students; 372 used it; 8,132 original + 1,986 follow-up queries; 8 educators interviewed. Fetched. — [arXiv 2401.11314v2](https://arxiv.org/html/2401.11314v2)
- Feature usage: General Question 38%, Question from Code 28%, Help Fix Code 23%, Explain Code 5.5%, Help Write Code 4%. Fetched. — [arXiv 2401.11314v2](https://arxiv.org/html/2401.11314v2)
- Quality (thematic analysis of 1,749 usages): 79% correct; 86% of correct answers helpful; after a mid-semester redesign correctness rose 74% to 87% and helpfulness 83% to 91%. Help Fix Code was rated lowest (about 2.4-2.9/5) versus about 4.0-4.2 for General Question and Explain Code. Fetched. — [arXiv 2401.11314v2](https://arxiv.org/html/2401.11314v2)
- Guardrail leakage: Help Write Code produced an exact solution in 53% of its analyzed cases; 6% of early general answers included generic example code. Fetched. — [arXiv 2401.11314v2](https://arxiv.org/html/2401.11314v2)
- Student complaints: answers too brief/shallow, sometimes wrong (especially fix suggestions), slow, weak on long code and multi-file projects, confident when wrong. Fetched. — [arXiv 2401.11314v2](https://arxiv.org/html/2401.11314v2)
- Four design considerations: D1 exploit AI's unique benefits; D2 simplify query formulation while promoting cognitive engagement; D3 avoid direct responses while encouraging motivated learning; D4 maintain transparency and control. Fetched. — [arXiv 2401.11314v2](https://arxiv.org/html/2401.11314v2)

**61A-Bot (UC Berkeley CS 61A; Zamfirescu-Pereira et al., SIGCSE 2025)**
- GPT-4 homework assistant delivered as one-shot contextual feedback inside the command-line autograder students already run; student code is wrapped in a custom prompt designed to avoid giving solutions. Over 2,000 students, over 100,000 requests, two semesters. Fetched (abstract). — [arXiv 2406.05600](https://arxiv.org/abs/2406.05600)
- Findings: forum homework-question rates fell; homework completion time dropped, by more than 30 minutes per assignment for students at the 50th-80th percentile (up to 50% less than same-percentile students in prior semesters). Comparison is against prior semesters, not a controlled trial. No learning outcome is reported in the abstract; authors caution that "even a thoughtfully-designed bot may not serve all pedagogical goals." Fetched (abstract). — [arXiv 2406.05600](https://arxiv.org/abs/2406.05600)

**CodeHelp (Liffiton, Sheese, Savelka, Denny, 2023)**
- LLM tool giving on-demand help without revealing solutions, using a multi-stage prompting pipeline with explicit guardrails; open source as part of the Gen-Ed framework for building generative-AI education web apps. Search snippet. — [arXiv 2308.06921](https://arxiv.org/abs/2308.06921); [Gen-Ed on GitHub](https://github.com/liffiton/Gen-Ed)
- Students fill a fixed set of help-request fields rather than free chat; students found it a valuable complement to instructor/TA support (third-party summary). Search snippet. — [arXiv 2407.15718](https://arxiv.org/html/2407.15718v1)
- Follow-up line of work on guardrail robustness: "CodeGuard: Improving LLM Guardrails in CS Education" (Feb 2026). Search snippet; not read. — [arXiv 2602.02509](https://arxiv.org/abs/2602.02509)

**Khanmigo (coding)**
- Tutors Python, JavaScript, HTML, CSS, SQL; can read the learner's code directly for review and feedback; priced at $4/month for learners; primarily K-12. Search snippet, mostly marketing pages. — [Khan Academy blog](https://blog.khanacademy.org/learning-to-code-with-modern-solutions-khanmigo-kl); [khanmigo.ai/learners](https://khanmigo.ai/learners)

**JetBrains Academy plugin (in-IDE courses)**
- AI hints introduced mid-2025: next-step suggestions, help with compilation errors, hints for failing tests; available for Python and Kotlin programming tasks in IDE-based Marketplace courses. Plugin 2025.3 added Machine Translation and Theory Lookup. Search snippet. — [JetBrains Education blog, 2 Jun 2025](https://blog.jetbrains.com/education/2025/06/02/ai-hints-plugin/); [plugin 2025.3 post](https://blog.jetbrains.com/education/2025/04/03/jetbrains-academy-plugin-2025-3-ai-features/)
- JetBrains Research published usage analysis of AI hints (Feb 2026) and an earlier research write-up (Jul 2025). Search snippet; not read. — [JetBrains Research, Feb 2026](https://blog.jetbrains.com/research/2026/02/how-ai-powered-hints-used/); [Jul 2025](https://blog.jetbrains.com/research/2025/07/ai-hints-for-online-learning/)
- Conflict inside the same IDE: YouTrack issue EDU-7800 reports that the general JetBrains AI Assistant and AI completion complete course exercises for the learner ("should be disabled for beginner courses") and that there was no application-wide setting to disable AI completion. Search snippet; my fetch of the issue returned empty, so date and resolution are unverified. — [YouTrack EDU-7800](https://youtrack.jetbrains.com/projects/EDU/issues/EDU-7800/JetBrains-AI-Assistant-should-be-disabled-for-beginner-courses)

**Replit**
- Replit deprecated Teams for Education (announced late 2023; removal and data deletion set for 1 Aug 2024). Discontinued. Search snippet. — [Replit blog](https://blog.repl.it/update-on-teams-for-education); [The Register, 21 Nov 2023](https://www.theregister.com/2023/11/21/comp_sci_panic/)

**Other course/vendor products seen**
- CodeHS: web IDE with optional AI tutor that nudges on the student's own code without giving the answer. Search snippet. — [CodeHS IDE](https://codehs.com/ide)
- CodeGrade: instructor-configurable AI assistant with a per-assignment "never write code" setting. Search snippet. — [CodeGrade](https://www.codegrade.com/solutions/ai-assistant)

### Inferences
- The durable pattern is "prompt + enforcement outside the model." CS50's post-generation checker and heart budget, CodeAid's hover-only fixes, and 61A-Bot's one-shot (non-conversational) delivery are all UI or pipeline constraints, not just instructions. A new IDE should assume a prompt alone leaks at double-digit rates.
- Every one of these is tied to a specific course's problem set and usually an intro course (CS50, CS1, second-year C). None targets a self-directed graduate auditor working through a research-grade PyTorch codebase; none knows assignment context unless a course's staff wire it in.
- Structured request types (CodeHelp, CodeAid) trade expressiveness for control. CodeAid's own data shows the least-used feature (Help Write Code, 4%) was also the leakiest.
- The JetBrains case shows a failure mode specific to general IDEs: a pedagogical feature (Academy hints) and a productivity feature (AI completion) coexisting, with the latter undermining the former.

### Gaps
- Georgia Tech course assistants (e.g., Jill Watson) and other course-deployed bots: not searched; no sourced findings.
- Khanmigo's coding guardrails in detail, any efficacy study for coding, and whether it has a code execution sandbox: not found.
- CodeHelp deployment numbers and student-reception statistics from the original paper: not retrieved.
- CodeAid's section comparing itself to ChatGPT use (why students left for ChatGPT) was truncated in my fetch.
- 61A-Bot: whether a VS Code surface exists and how students rated hints (v3 of the paper) not retrieved.
- CS50 Duck: exact heart-system numbers, current model, and adoption figures for 2026 not found. The "instruction dilution" attribution to arXiv 2510.02347 comes from a search summary and should be verified.
- Replit's current (2026) education stance beyond the discontinuation: not checked.

## 2. General-AI "learning modes" (Claude, Claude Code, ChatGPT Study Mode, Gemini Guided Learning, GitHub Copilot education)

### Takeaway
All major vendors shipped a learning mode in 2025, and all are system-prompt-level behaviors that the user can switch off at will. Claude Code's Learning output style is the only one that operates inside a real coding workflow (it leaves `TODO(human)` markers in files), but it is still an agent that writes most of the code and its own docs say nothing enforces the style.

### Cited Findings

**Claude Code output styles (docs fetched 26 Nov 2026)**
- Five options: Default plus four built-ins (Proactive, Concise, Explanatory, Learning). Each built-in keeps the default software-engineering instructions and adds its own. — [Claude Code docs: Output styles](https://code.claude.com/docs/en/output-styles.md)
- Explanatory: Claude does the task as in Default and adds short `★ Insight` blocks (two or three points) explaining its choices. — [Claude Code docs](https://code.claude.com/docs/en/output-styles.md)
- Learning: same Insight blocks, plus "asks you to write some of the code. Claude handles routine implementation itself. When it reaches a piece with a real design decision, such as error handling, a data structure, or business logic with more than one valid approach, it leaves a few lines for you." It writes a `TODO(human)` comment in the file, sends a "Learn by Doing" request (Context / Your Task / Guidance), then stops and waits; after the user writes the code it gives one Insight and continues. Docs position it for when "you want hands-on coding practice while the task still gets done." — [Claude Code docs](https://code.claude.com/docs/en/output-styles.md)
- Documented limitation: "An output style gives Claude instructions to follow. It doesn't guarantee that something always happens or never happens." and "It's an instruction Claude follows, so nothing enforces it." Hooks are the documented mechanism for anything that must happen every time. — [Claude Code docs](https://code.claude.com/docs/en/output-styles.md)
- Styles do not apply to subagents other than forks (subagents run their own system prompt). Explanatory and Learning raise output-token use by design. — [Claude Code docs](https://code.claude.com/docs/en/output-styles.md)
- Switching: `/output-style <style>`, `/config`, VS Code extension command menu, or `outputStyle` in settings (saved to `.claude/settings.local.json`); switching takes effect on the next message. One command reverts to Default. — [Claude Code docs](https://code.claude.com/docs/en/output-styles.md)
- Extensible: custom output styles are Markdown files in `~/.claude/output-styles` or `.claude/output-styles` (also managed-policy level and shippable in plugins, with `force-for-plugin`); `keep-coding-instructions: true` retains the engineering instructions. — [Claude Code docs](https://code.claude.com/docs/en/output-styles.md)
- Unofficial source dump of the Learning prompt says it requests human contributions of about 2-10 lines when generating 20+ lines involving design decisions, with exactly one `TODO(human)` section. Unverified third-party mirror; search snippet. — [tangled.org mirror](https://tangled.org/nonbinary.computer/claude-code/raw/main/constants/outputStyles.ts)

**Claude Learning mode (claude.ai / Claude for Education)**
- Started April 2025 inside Claude for Education; opened to all claude.ai users in August 2025 as a "Learning" option in the style dropdown, which can be enabled or disabled at any time. Uses Socratic questioning and step-by-step guidance. Search snippet. — [Engadget, Aug 2025](https://www.engadget.com/ai/anthropic-brings-claudes-learning-mode-to-regular-users-and-devs-170018471/); [Anthropic: Introducing Claude for Education](https://www.anthropic.com/news/introducing-claude-for-education)

**ChatGPT Study Mode (fetched)**
- Launched 29 Jul 2025 for logged-in Free, Plus, Pro, Team users, with Edu to follow. Guiding questions, scaffolded explanations, knowledge checks. — [OpenAI](https://openai.com/index/chatgpt-study-mode/)
- Implemented as custom system instructions written with teachers and learning scientists; OpenAI states this "results in some inconsistent behavior and mistakes across conversations" and that it plans to train the behavior into main models. — [OpenAI](https://openai.com/index/chatgpt-study-mode/)
- "Easily toggle study mode on and off during a conversation." Future plans listed at launch: goal setting and progress tracking across conversations, deeper personalization (i.e., not present at launch). — [OpenAI](https://openai.com/index/chatgpt-study-mode/)
- For coding specifically, a DataCamp reviewer could not write and execute code in the Study Mode interface and suggested pairing it with a coding interface. Search snippet. — [DataCamp tutorial](https://www.datacamp.com/tutorial/chatgpt-study-mode)

**Gemini Guided Learning (fetched)**
- Announced 6 Aug 2025. Step-by-step breakdowns, adaptive explanations, images/diagrams/videos, interactive quizzes, flashcards and study guides. Free one-year AI Pro for students in the US, Japan, Indonesia, Korea, Brazil at launch. Article lists no limitations and does not mention LearnLM. — [TechCrunch, 6 Aug 2025](https://techcrunch.com/2025/08/06/google-takes-on-chatgpts-study-mode-with-new-guided-learning-tool-in-gemini/)

**GitHub Copilot for students**
- Free access continues but moved to a dedicated "GitHub Copilot Student" plan announced 12-13 Mar 2026; premium models (Claude Opus, Claude Sonnet, GPT-5.4) removed from the student model picker. Described as including unlimited completions plus an allowance of AI credits. Usage-based billing applies to all Copilot plans from 1 Jun 2026. Search snippet. — [GitHub Changelog, 13 Mar 2026](https://github.blog/changelog/2026-03-13-updates-to-github-copilot-for-students/); [The Register, 13 Mar 2026](https://www.theregister.com/2026/03/13/microsoft_github_removes_models_student_plan/); [GitHub docs: student setup](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-students); [billing FAQ discussion](https://github.com/orgs/community/discussions/197089)
- Conflicting third-party reports on whether student sign-ups were paused (20 Apr 2026) and reopened (17 Jun 2026). Search snippet. — [Chalkbox](https://www.chalkbox.org/guides/github-copilot-student/); [Agentdex](https://agentdex.app/blog/copilot-student/)
- My searches found no GitHub Copilot "learning mode" or "study mode" announcement. The student plan is a pricing/model tier, not a pedagogical behavior. — [GitHub Changelog, 13 Mar 2026](https://github.blog/changelog/2026-03-13-updates-to-github-copilot-for-students/)

### Inferences
- The three chat learning modes (Claude, ChatGPT, Gemini) are not editor-aware: they do not see a project, run code, or track what the learner has written. This is my reading of the product descriptions; only the DataCamp note directly documents it for Study Mode.
- All are opt-in toggles with a one-click exit, so the guardrail is exactly as strong as the student's resolve at 2 a.m. OpenAI's own page concedes inconsistency.
- Claude Code Learning style is the closest existing artifact to the target concept, but its premise is inverted for a student: the agent owns the task and delegates 2-10 line fragments to the human. For CS336, where the assignment is the implementation, the student needs to own the code and the AI to own the hints. It is also terminal/agent-shaped, which is the complexity the motivating user wants to avoid.
- Claude Code's extension points (custom output styles, hooks, plugins with `force-for-plugin`, managed settings) are a realistic substrate to build a stricter tutor mode on without a new editor: a hook could block Edit/Write tool calls outright, which converts an instruction into enforcement. This is an inference from the docs, not a documented recipe.
- Copilot's student offer subsidizes exactly the autocomplete-heavy usage that educators ask students to disable.

### Gaps
- No primary Anthropic page fetched for claude.ai Learning mode; details of current (late 2026) behavior, projects/memory integration, and whether it persists across chats are unverified.
- LearnLM's relationship to Guided Learning and any coding-specific evaluation: not sourced.
- No documented bypass studies ("jailbreak" rates) for Study Mode / Guided Learning / Claude Learning mode were found.
- Whether any of these modes gained persistence or progress tracking during 2026: not checked.
- Whether Claude Code's Learning style changed materially during 2026 beyond what the current docs state: changelog not reviewed.

## 3. Mainstream editors: controls to turn AI down or off, and whether any shipped a student mode

### Takeaway
Every mainstream editor now has an off switch (VS Code `chat.disableAIFeatures`, Zed `disable_ai`, per-feature toggles in Cursor and Windsurf), but the controls are binary on/off or instruction files, not pedagogical. I found no evidence that VS Code, Cursor, Zed, Windsurf, or JetBrains has shipped an explicit student or learning mode as of late 2026.

### Cited Findings
- VS Code: `chat.disableAIFeatures` disables and hides built-in AI features (chat, inline suggestions) and disables the Copilot extensions; also exposed as "Chat: Hide AI Features." Search snippet of official docs. — [VS Code AI settings reference](https://code.visualstudio.com/docs/copilot/reference/copilot-settings)
- VS Code leaks: one issue reports the setting did not hide chat in 1.105.1; another reports C/C++ extension AI registration still running with the setting on. Search snippet. — [vscode-cpptools issue 14294](https://gh.hhj520.top/microsoft/vscode-cpptools/issues/14294)
- Instructors already publish manual "disable AI in VS Code" guides for courses, which signals the absence of a first-class course/student profile. Search snippet. — [Harvey Mudd CS 133 guide](https://www.cs.hmc.edu/~beth/courses/cs133/lab/guides/vscode/index.html)
- Zed: `"disable_ai": true` in settings turns off all AI features (shipped mid-2025). Search snippet. — [Zed blog](https://zed.dev/blog/disable-ai-features)
- Zed leak: issue reports AI keybindings remain active and intercept keys with AI disabled. Search snippet. — [Zed issue 56692](https://github.com/zed-industries/zed/issues/56692)
- Cursor: has Agent / Ask / Plan / Debug modes; Tab can be toggled off (command palette "Cursor: Toggle Tab" or status-bar icon) per third-party guides. Custom modes arrived as a beta in 0.48; a 2026 guide and a forum thread say custom modes were removed in Cursor 2.1 (late 2025). Sources conflict/are partly unofficial. Search snippet. — [Cursor changelog 0.48](https://cursor.com/changelog/0-48-x); [Cursor modes guide (third party)](https://www.cursorforpms.com/guides/cursor-modes-explained); [Cursor forum](https://forum.cursor.com/t/default-model-selection-per-mode-agent-ask-plan-debug/150676)
- Windsurf: docs at docs.windsurf.com are now titled "Devin Docs" / "Devin Desktop"; Tab settings include a Completion mode with "Off," and autocomplete can be switched off or snoozed from the status bar. Search snippet. — [Windsurf/Devin docs: Tab](https://docs.windsurf.com/tab/overview); [Autocomplete tips](https://docs.windsurf.com/autocomplete/tips)
- JetBrains: user report that there was no application-wide setting to disable AI completion and that AI Assistant completes Academy exercises. Search snippet; unverified date/status. — [YouTrack EDU-7800](https://youtrack.jetbrains.com/projects/EDU/issues/EDU-7800/JetBrains-AI-Assistant-should-be-disabled-for-beginner-courses)
- Student mode check: a targeted search for a learning/student mode in Cursor, VS Code, or Copilot returned only third-party advice to manually turn autocomplete off for graded coursework, not a product feature. — [Vertech Academy guide](https://www.vertechacademy.com/blog/best-ai-coding-tools-students)
- Community advice follows the same manual pattern: default AI suggestions to off in every IDE and turn on when needed. Search snippet. — [Advice for CS Students in the AI Era (gist)](https://gist.github.com/markm208/994e07b5956348b167158d87fbb9e5a1)

### Inferences
- A student can assemble a rough tutor-only setup today: disable Tab/inline completion, use an Ask (read-only) mode, and add a rules/instructions file saying "never write code, give hints." What breaks: (a) the rule file is a prompt, so it leaks at rates like those measured for the CS50 Duck and CodeAid; (b) Ask mode still prints complete code in chat that can be pasted; (c) the off switches are one click from on, and agent mode is one dropdown away; (d) settings are per-machine and per-editor with no persistence of learner state, hint budgets, or progress; (e) documented leaks where disabled AI still surfaces (VS Code chat visibility, Zed keybindings). Items (a)-(d) are reasoning from cited mechanisms, not tested results.
- Cursor removing custom modes (if confirmed) makes it harder, not easier, to build a persistent tutor persona there; VS Code custom agents and Claude Code output styles/hooks are the more plausible host platforms.
- The gap is not "AI off" (solved) but "AI constrained to pedagogy with enforcement and state" (unsolved in mainstream editors).

### Gaps
- No official Cursor documentation fetched for Tab disable, rules files, or the status of custom modes in late 2026; the removal claim needs verification.
- VS Code custom agents/chat modes and `.github/copilot-instructions.md` behavior: not sourced in this session. No community "tutor" custom agent of note was found, but the search was shallow.
- JetBrains AI Assistant disable controls as of 2026 and whether EDU-7800 was fixed: not verified.
- Absence of a shipped learning mode is based on negative search results, not an exhaustive changelog review of each editor. Treat as "none found," not "confirmed none."
- The Windsurf to "Devin Desktop" rename is inferred from page titles in search results; not confirmed by an announcement.

## 4. Beginner-focused non-AI or lightly-AI editors and design lessons

### Takeaway
The classic teaching editors win by removing things and by making program state visible, not by adding assistance; where AI has been added (Python Tutor, marimo, Thonny plugins) it is either tightly coupled to the tool's core pedagogy (Python Tutor's "Visualize Me") or is ordinary unguarded completion/chat.

### Cited Findings
- Python Tutor (Philip Guo, UCSD): step-by-step execution visualizer; 25M+ learners in 180+ countries, 500M+ visualizations, 10k-20k daily users. Now has an AI chat that explains code and helps with compiler/runtime errors; generated examples carry a "Visualize Me" button so the learner steps through them in the visualizer. Guo's stance: AI-written code still requires human understanding. Search snippet. — [UC San Diego Today](https://today.ucsd.edu/story/a-uc-san-diego-tool-teaching-code-to-25-million-is-even-more-critical-in-age-of-ai)
- BlueJ: purpose-built for teaching OOP in beginner courses; design intent is that the environment "blends into the background" so focus shifts to programming principles. Search snippet. — [Kent archive paper](https://www.cs.kent.ac.uk/pubs/2003/2190/content.pdf)
- DrRacket: staged teaching language levels (Beginning Student, etc.) that expose only the constructs needed at each stage, paired with the design recipe. Search snippet. — [DrRacket docs: HtDP teaching languages](https://docs.racket-lang.org/drracket/htdp-langs.html)
- Thonny: no official AI assistant found; only third-party plugins on PyPI (thonny-codemate, thonny-lmvibe, thonny-openai-gpt, thonny-chatbot-plugin), offering chat and code generation, some early-stage. Search snippet. — [thonny-codemate on PyPI](https://pypi.org/project/thonny-codemate/); [thonny-chatbot-plugin](https://pypi.org/project/thonny-chatbot-plugin/)
- marimo: built-in AI includes Tab autocompletion, error auto-fix, integrated chat, and "marimo pair" for connecting coding agents to a running notebook; multiple model providers. molab (free hosted notebooks) ships AI assistance out of the box; marimo markets to educators and learners. Search snippet. — [marimo AI completion docs](https://docs.marimo.io/guides/editor_features/ai_completion/); [marimo for educators](https://marimo.io/for-educators); [Pitt case study](https://marimo.io/blog/case-study-pitt)
- mljar "Teacher Mode" (Show HN): converts AI notebook output into fill-in-the-blank quizzes where the student picks the missing line from three options. Search snippet. — [Hacker News item 44156717](https://news.ycombinator.com/item?id=44156717)

### Inferences
- Reusable design lessons: (1) subtraction as a feature (BlueJ, and by reputation Thonny/Mu); (2) staged capability levels that unlock as the learner progresses (DrRacket) map naturally onto staged AI help levels; (3) tie any AI output back to an activity that forces engagement (Python Tutor's visualize-the-generated-code loop); (4) make runtime state visible, which for CS336 would mean tensor shapes, dtypes, devices, and gradients rather than stack frames.
- marimo is education-friendly but its AI is productivity-style (completion, auto-fix, agents); no learner guardrail was evident in the sources.
- None of these tools targets graduate-level ML engineering work. Python Tutor in particular is built for small single-file programs.

### Gaps
- Mu, Thonny's own design rationale, and Jupyter teaching tooling (nbgrader, JupyterLab AI, Jupyter AI personas) were not researched; no sourced findings.
- Python Tutor AI tutor specifics (model, guardrails, whether it withholds solutions, evaluation) not retrieved; Guo's O'Reilly Radar post was referenced by search but not read.
- Whether marimo has any tutor/education AI mode in late 2026: not verified.

## 5. Research prototypes and evidence (2023-2026)

### Takeaway
Research supports the core premise (unguarded AI help reduces skill formation even as it speeds work) and identifies friction designs that work (explain-before-reveal), but 2026 results add a strong warning: heavy Socratic guardrails with full context were the least-liked condition in an RCT and pushed students toward outside LLMs. The design target is calibrated friction, not maximal restriction.

### Cited Findings
- Anthropic RCT (Shen and Tamkin, posted 29 Jan 2026): 52 mostly junior engineers learning the Trio Python library; AI assistance produced a statistically significant decrease in mastery with a small, non-significant speedup. Some high-engagement interaction patterns were associated with retained learning, but the paper does not claim causality, and comprehension was measured immediately after the task only. Search snippet. — [Anthropic research post](https://www.anthropic.com/research/AI-assistance-coding-skills); [arXiv 2601.20245](https://www.arxiv.org/pdf/2601.20245)
- Bastani et al. (PNAS 2025), high-school math field experiment, about 1,000 students: unguarded "GPT Base" raised practice performance 48% but lowered later unassisted exam performance 17% versus control; guardrailed "GPT Tutor" raised practice performance 127% and largely eliminated the harm, but exam scores only matched control (no gain). Not a programming study. Search snippet. — [SSRN 4895486](https://papers.ssrn.com/abstract=4895486); [Wharton summary](https://knowledge.wharton.upenn.edu/article/without-guardrails-generative-ai-can-harm-education/)
- "Guardrails or Roadblocks?" (Eastwood, Narne, Hilby, Denny, Aggarwal, Kapoor; arXiv 24 Sep 2026; preprint): 2x2 RCT, 132 intro-programming students, Socratic vs direct instruction crossed with no context vs full context of problem and student code. Socratic + full context was rated least favorably with significantly lower perceived support; it also had (not statistically significant) the highest stress, highest external-LLM use, and lowest share of full-comprehension explanations. Conclusion: guardrailed tools are not automatically better for learning. Fetched (abstract). — [arXiv 2609.29995](https://arxiv.org/abs/2609.29995)
- Kazemitabaar et al. (IUI 2025), "Exploring the Design Space of Cognitive Engagement Techniques with AI-Generated Code": compared seven techniques. "Lead-and-Reveal" (AI walks through the problem step by step and the learner must explain each decision before the code line is revealed) and "Trace-and-Predict" beat baseline for learning/engagement; Lead-and-Reveal gave better calibration between perceived and actual ability at moderately more time and no significant increase in cognitive load. Too much friction caused frustration. All conditions used Ivie-style on-hover line explanations. Search snippet. — [ACM DL](https://dl.acm.org/doi/full/10.1145/3708359.3712104); [author PDF](https://austinhenley.com/pubs/Kazemitabaar2025IUI_AIFriction.pdf)
- "Mitigating Epistemic Debt in Generative AI-Scaffolded Novice Programming using Metacognitive Scripts" (arXiv, Feb 2026): an "Explanation Gate" requires learners to articulate the causal logic of AI-generated code before integration is permitted. Search snippet; results not retrieved. — [arXiv 2602.20206](https://arxiv.org/html/2602.20206v2)
- "Do Not Copy/Paste: Soft Barriers for Copying in AI-Assisted Programming" (Olatunji et al., ASE 2026): Unicode perturbations make pasted AI code syntactically invalid; benchmark across four LLMs on HumanEval/MBPP plus an 18-person pilot showing a shift from direct transfer toward editing and reconstruction. Authors frame it as a probe, not deployment-ready. Fetched (abstract). — [arXiv 2608.22638](https://arxiv.org/abs/2608.22638)
- "Agents That Teach" (Mehra et al., ASE 2026 NIER, 5 pages): coins "Knowledge Debt"; proposes six design principles and SHIELD, a multi-agent system that surfaces out-of-band learning moments from the coding agent's reasoning. Vision paper; no evaluation reported in the abstract. Aimed at professional developers. Fetched (abstract). — [arXiv 2607.06101](https://arxiv.org/abs/2607.06101)
- Additional 2025-2026 leads seen but not read: "Scaffolding Metacognition in Programming Education" (arXiv 2511.04144); "Improving Student-AI Interaction Through Pedagogical Prompting" (arXiv 2506.19107); "SocraticRepair: Planning-Guided Socratic Tutoring for Program Debugging and Misconception Repair" (arXiv 2610.15204); "Editrail: Visualizing Student-AI Interaction in Code" (arXiv 2601.20085, instructor-facing); "Howzat?" on evaluating next-step hints (arXiv 2411.18151); "Learning from Teaching Assistants to Program with Subgoals" (arXiv 2309.10419). — [2511.04144](https://arxiv.org/pdf/2511.04144); [2506.19107](https://arxiv.org/pdf/2506.19107); [2610.15204](https://arxiv.org/pdf/2610.15204); [2601.20085](https://arxiv.org/pdf/2601.20085); [2411.18151](https://arxiv.org/pdf/2411.18151); [2309.10419](https://arxiv.org/pdf/2309.10419)
- Overly restrictive guardrails send students to unguarded tools (finding surfaced in a metacognition paper and consistent with the 2026 RCT). Search snippet. — [arXiv 2511.04144](https://arxiv.org/pdf/2511.04144)

### Inferences
- Evidence hierarchy: strong for "unguarded AI harms learning" (two RCT-style studies); moderate for "specific friction designs help" (lab studies, short horizon); weak to absent for "a deployed guardrailed coding tutor improves learning" (deployments report time saved and satisfaction, and Bastani's guardrailed tutor only matched control).
- The Guardrails-or-Roadblocks result argues for direct, context-aware explanation of concepts combined with withholding of the assignment's code, rather than blanket Socratic questioning. For a graduate auditor with no grade at stake, learner-controlled friction levels are likely essential, since the exit to ChatGPT is always available.
- Mechanisms worth reusing: explain-before-reveal gating, trace-and-predict, hover-only natural-language fixes, pseudo-code/sub-goal output, post-generation output checking, hint budgets, soft paste barriers.
- Nearly all studies use novices on small tasks. I found nothing evaluating pedagogical AI for advanced ML coursework (multi-file PyTorch, training loops, debugging numerical issues).

### Gaps
- Ivie (the original paper, venue, and its evaluation) was only seen cited inside the IUI 2025 paper; I did not retrieve the primary source.
- Socratic debugging tutor evaluations (e.g., "Instruct, Not Assist", SocraticRepair results), hint-generation systems, "code review not generation" assistants, and design-level-help tools: named in search results but not read; no findings to report.
- No SIGCSE/ICER/L@S 2026 proceedings were systematically searched.
- Long-term retention data: none found in any study.

## 6. Startups and open-source "learning IDE" projects (2025-2026) and user reception

### Takeaway
I found a handful of small commercial tools with a "never writes your code" promise (CodeTrain, CodeHS's tutor, CodeGrade's assistant) but no established, well-adopted "AI IDE for students," and no traction data for any of them. This segment looks open, though my search for community reception was shallow.

### Cited Findings
- CodeTrain (codetrain.ai, by InferHaven; beta): Socratic tutor that turns a real task in the learner's own repository into small steps, reviews each line the learner writes, runs checks, and gives hints. Stated rule: never writes or pastes the solution, "not even one line"; each step must pass before advancing. Delivery: browser lesson editor, a CLI for repo mode, and a free open-source "Open Skill" installed via `npx skills add` that runs inside existing coding agents (Claude Code, OpenCode, Antigravity CLI named). Pricing: Free (10 lessons/month, public repos), Pro $24/month, Team $79-$399/month, Enterprise custom. Target: developers learning unfamiliar codebases and teams onboarding hires, not students. No user counts or testimonials on the page; Product Hunt and Fazier badges only. Fetched. — [codetrain.ai](https://codetrain.ai/)
- CodeGrade AI assistant: instructor sets per-assignment policy including "never write code." Institutional LMS-style product. Search snippet. — [CodeGrade](https://www.codegrade.com/solutions/ai-assistant)
- CodeHS: K-12 web IDE with optional AI tutor that nudges without giving the answer. Search snippet. — [CodeHS](https://codehs.com/ide)
- JDoodle: browser IDE with an AI companion plus classroom/assessment features. Search snippet. — [JDoodle](https://www.jdoodle.com/)
- A "Show HN" search for an AI code editor that teaches rather than writes returned no direct match; nearest hits were mljar Teacher Mode and a kids' menu-based language. — [HN 44156717](https://news.ycombinator.com/item?id=44156717); [HN 38365638](https://news.ycombinator.com/item?id=38365638)
- Reception signals found are indirect: instructor and student advice to switch AI off by default while learning, and a University of Michigan professor (Severance) advising beginners to stay away from AI. Search snippet. — [Advice for CS Students gist](https://gist.github.com/markm208/994e07b5956348b167158d87fbb9e5a1); [The Register, Jan 2024](https://www.theregister.com/2024/01/27/ai_coding_automatic/)

### Inferences
- CodeTrain is the nearest commercial analogue in mechanism (repo-aware, step-gated, hint-only, also ships as a skill inside Claude Code), but it is priced and positioned for professional onboarding. A student-focused product could differ on audience, pricing, course awareness (assignment handouts, lecture alignment), and ML-specific scaffolding.
- Delivery as a skill/plugin inside an existing agent (CodeTrain's Open Skill; Claude Code output styles and plugins) is an existing low-cost distribution path, but it inherits the agent-centric interface the motivating user dislikes. A simple standalone editor or a minimal VS Code profile would be the differentiator.
- The differentiating gap, combining all sections: (1) enforcement outside the prompt; (2) persistent learner state and hint budgets; (3) editor and runtime awareness for real multi-file ML code; (4) calibrated, learner-adjustable friction instead of blanket Socratic refusal; (5) a deliberately small UI with no agents, no orchestration; (6) support for self-directed advanced learners outside any course's staff-configured tooling.

### Gaps
- I found no Hacker News, r/learnprogramming, r/csMajors, or r/cscareerquestions threads discussing specific learning IDEs; the Reddit-directed search returned papers and blogs instead. User reception for these products is effectively unresearched.
- No traction, funding, or user numbers for CodeTrain or any similar startup. CodeTrain's claims are from its own marketing page only.
- Open-source projects on GitHub explicitly branded as "learning IDE" or "AI IDE for students" were not searched directly.
- One Show HN result ("Huzzah", item 49378768) appeared in results but I did not open it and cannot say what it is.
- Absence of a dominant player is based on limited searching and should be stated as "none found."
