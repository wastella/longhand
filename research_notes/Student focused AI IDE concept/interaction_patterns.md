# Human-AI interaction design patterns in programming tools: what helps learning, what hurts it (as of November 2026)

Reading guide for the report writer

- Evidence grades used throughout: **[RCT]** randomized/controlled experiment with a learning or performance outcome; **[QUASI]** within-subjects, observational or correlational with outcome data; **[QUAL]** think-aloud, interview, deployment logs, survey; **[DESIGN]** design opinion, product documentation or practitioner report.
- Verification level: sources marked **(read)** were opened and read (fully or the first ~100k characters). Sources marked **(summary)** were seen only through search-result summaries; their numbers should be re-checked against the paper before being quoted in a final report.
- Motivating user context, confirmed from the course site: Stanford CS336 says "Prompting LLMs such as ChatGPT is permitted for low-level programming questions", "using it directly to solve the problem is prohibited", and "We strongly encourage you to disable AI autocomplete (e.g., Cursor Tab, GitHub CoPilot) in your IDE when completing assignments (though non-AI autocomplete, e.g., autocompleting function names is totally fine)"; "students will be given minimal scaffolding" — [CS336 course site](https://cs336.stanford.edu/) (read). Assignment 1 ships a test suite where "Initially, all tests should fail with `NotImplementedError`s" and the student connects their code through `./tests/adapters.py` — [stanford-cs336/assignment1-basics](https://github.com/stanford-cs336/assignment1-basics) (read).

---

## 1. Graduated hint ladders (orientation -> conceptual -> pseudo-code -> specific line -> worked solution)

### Takeaway
Multi-level on-demand hints are worth keeping, but the classic "hint button that bottoms out in the answer" is consistently associated with worse learning when learners request hints before attempting or click through to the bottom; the evidence that this is causal is weak, and the evidence that delays/costs fix it is weaker still. In LLM hint studies with programmers, the most useful rung was a worked example on an *analogous* problem, not abstract natural-language hints and not the exact next lines.

### Cited Findings

Classic ITS literature
- In a Geometry Cognitive Tutor unit, students "abused" hints on 36% of actions (14% when rapid consecutive hint clicks are collapsed into one action); the same framework defines the opposite failure, help *avoidance*. [QUASI] — [LearnLab wiki summarizing Aleven et al. 2006](https://learnlab.org/research/wiki/index.php/Help_abuse) (summary)
- Gaming the system (systematic guessing, hint click-through) is correlated with substantially lower learning in Cognitive Tutors. [QUASI] — [Baker, Corbett & Koedinger 2004](https://www.cs.cmu.edu/~rsbaker/BCK2004MLFinal.pdf) (summary)
- The Help Tutor (real-time metacognitive feedback on help-seeking, e.g. "slow down, read the hint") reduced help-seeking errors while active, but the first classroom evaluation found no evidence that students learned help-seeking skills or the domain better. A later, fuller version (67 students, added instruction and self-assessment) showed improved help-seeking persisting for a month after support was removed. Aleven et al.'s overall synthesis: feedback on help seeking made help use more deliberate "but did not produce better learning outcomes". [RCT/QUASI] — [Roll et al. Help Tutor (2006)](https://kilthub.cmu.edu/articles/journal_contribution/The_Help_Tutor_Does_Metacognitive_Feedback_Improve_Students_Help-Seeking_Actions_Skills_and_Learning_/6470516); [Roll, Aleven, McLaren & Koedinger 2011](https://www.cs.cmu.edu/~bmclaren/pubs/RollEtAl-ImprovingMetacogSkillsWithITS-LandI2010.pdf); [Aleven et al., "Help Helps, but Only So Much"](https://cris.iucc.ac.il/en/publications/help-helps-but-only-so-much-research-on-help-seeking-with-intelli/) (all summary)
- LAK 2026 replication across three semesters, 999 K-12 maths students (1,370 enrolled), a 3-level hint ladder ending in a bottom-out answer: two simple log indicators, (a) requesting a hint before any attempt and (b) advancing through hints faster than a reading speed of ~4 words/second, were both negatively associated with post-test and one-week delayed post-test. For hint-before-attempt in one semester (N=277): Spearman rho = -0.617 (post) and -0.634 (delayed); after controlling for pretest, beta = -0.28 (post) and -0.37 (delayed). Lower-prior-knowledge students did it more (rho = -0.567 with pretest). Authors stress this is correlational. [QUASI] — [An, Mehrvarz, Stamper & McLaren, LAK 2026](https://www.cs.cmu.edu/afs/cs.cmu.edu/Web/People/bmclaren/pubs/AnEtAl-RevisitingTheHintButton-LAK2026.pdf) (read)
- Same paper, design position: "the primary design implication is not to remove hints, but to re-engineer hint delivery mechanisms to be more resistant to unproductive use". They propose (untested) delaying the bottom-out hint until a minimum engagement time or number of attempts, but caution that "delayed access alone is unlikely to be sufficient" because prior help-regulation interventions changed behaviour without domain gains; they propose requiring self-explanation / LLM Socratic dialogue at the point of help. They also note that "some high-performing students may strategically use bottom-out hints as worked examples when encountering a novel problem type" (citing Shih, Koedinger & Scheines 2008). [DESIGN, citing QUASI] — [An et al., LAK 2026](https://www.cs.cmu.edu/afs/cs.cmu.edu/Web/People/bmclaren/pubs/AnEtAl-RevisitingTheHintButton-LAK2026.pdf) (read)
- Same paper cites prior work that students benefit more when they regulate hint timing themselves than when hints arrive automatically, and that attempting before asking is better "even when students feel uncertain". [QUASI, secondary citation] — [An et al., LAK 2026](https://www.cs.cmu.edu/afs/cs.cmu.edu/Web/People/bmclaren/pubs/AnEtAl-RevisitingTheHintButton-LAK2026.pdf) (read)

LLM hint ladders for programming
- LLM Hint Factory (CHI EA 2024): four levels — (1) orientation, ~2 sentences on where to focus; (2) instrumental, describes the first error and how to proceed without a specific solution; (3) worked example, a similar snippet with different variable names/scenario and inline comments; (4) bottom-out, the exact code for the next step (~7 lines). Buttons: "Be More Specific", "Be More General", "New Hint". Think-aloud study, 12 novices (CS1 Python only), three data-analysis tasks. [QUAL] — [Xiao, Hou & Stamper 2024](https://arxiv.org/html/2404.02213v1) (read)
- Findings: "high-level natural language hints alone can be helpless or even misleading", especially for next-step or syntax questions; all three hints that led students to wrong actions were high-level; 4 of 12 students were frustrated when hints repeated what they already knew. Worked examples were the level most often followed by a correct change (59.32% of appropriate-hint instances); only 5 correct changes followed bottom-out hints. High-level hints were often sufficient for *logic* bugs. 27.14% of correct hints had no observable effect; 7 of 12 said button-triggered hints sometimes did not match their actual question. Authors recommend choosing the level from the request type and a menu of help-request types rather than always starting at the top. [QUAL] — [Xiao, Hou & Stamper 2024](https://arxiv.org/html/2404.02213v1) (read)
- "Feedback ladder" (UMass): LLM generates several levels of feedback for the same submission; user study found diminishing effectiveness for higher (more abstract) levels and for higher-scoring submissions. [QUAL/QUASI] — [Lan et al.](https://par.nsf.gov/servlets/purl/10598957) (summary)
- Berkeley CS 61A bot (GPT-4 hints in a large CS1): students with access resolved problems faster; hint levels were not varied and the paper frames the result as homework time saved, not learning gained. [QUASI] — [61A Bot Report](https://arxiv.org/html/2406.05600v3) (summary)
- Model quality of next-step hints varies considerably across models (Java novices, expert-judged). [QUASI] — [Howzat?, 2024](https://arxiv.org/html/2411.18151v1) (summary)
- Bastani et al. (PNAS 2025), ~1,000 high-school maths students: an unrestricted chat tutor (GPT Base) raised practice scores 48% but lowered unassisted exam scores 17% versus no AI; a hint-only tutor (GPT Tutor: teacher-authored hints, no direct answers) raised practice scores 127% and left exam scores about equal to control. Strongest causal evidence that withholding the bottom-out answer removes harm; note it did not produce a learning *gain* over no AI. [RCT] — [SSRN](https://papers.ssrn.com/abstract=4895486); [Wharton summary](https://knowledge.wharton.upenn.edu/article/without-guardrails-generative-ai-can-harm-education/) (summary)

### Inferences
- A defensible ladder for the editor: (0) "what have you tried / what do you expect?" attempt gate; (1) orientation; (2) conceptual/instrumental; (3) analogous worked example in a different context (e.g. a toy tensor shape problem rather than the learner's attention function); (4) pinpointed location ("the bug is in how you mask, lines 40-48") — and no rung that emits the learner's exact code. This matches Xiao et al. (worked example was the productive ceiling) and Bastani et al. (no-answer tutor removed harm).
- Starting every request at rung 1 is itself a failure mode: Xiao et al. show abstract hints irritate and occasionally mislead. Let the learner or a request classifier jump to the right rung (syntax/API questions should be answered directly; logic bugs start high).
- Instrument the two LAK 2026 indicators (hint-before-attempt, hint read time below reading speed). They are cheap and replicated; use them for the learner's own dashboard rather than for enforcement, since causal direction is unknown.
- Transfer to the CS336 learner: hint abuse is concentrated in low-prior-knowledge, externally-motivated students; the bottom-out-as-worked-example use by strong students suggests an advanced voluntary learner is less at risk and more harmed by rigid top-down ladders. But time pressure and frustration, not grades, drive click-through, and those exist for auditors too.

### Gaps
- I found no randomized study that varies hint *delay* or *cost* (timers, hint budgets, point costs) for LLM programming hints and measures learning. An et al. 2026 explicitly lists this as future work.
- Shih, Koedinger & Scheines (EDM 2008) on time spent after bottom-out hints as worked-example self-explanation is cited via An et al.; I did not read it directly.
- No hint-ladder study on advanced topics (ML systems, PyTorch); all programming evidence is CS1-level.
- An online-course study of "structured LLM feedback" reporting that simple hints gave faster time-to-solution surfaced only as an [alphaXiv listing](https://www.alphaxiv.org/abs/2605.16933.md); unverified.

---

## 2. Socratic questioning by LLM tutors; letting learners choose the help level

### Takeaway
Socratic tutoring has plausible mechanism support and some evidence of better later learning than answer-giving, but learners rate it as slower, and in voluntary settings many simply stop using it or go elsewhere. The best-supported compromise is learner-led questioning ("ask me to explain each step before revealing it") with feedback on wrong answers and a visible way to get more direct help.

### Cited Findings
- Khanmigo field evidence: in a study of Tennessee middle schoolers (draft NBER paper as reported), many students tried to extract answers; when the tutor asked questions and gave hints instead, "most students declined it most of the time"; gains were modest and no larger than earlier estimates for Khan Academy practice without AI. [QUASI, reported via journalism] — [KQED/Hechinger](https://www.kqed.org/mindshift/66662/students-didnt-get-answers-from-khanmigo-they-didnt-want-its-questions-either); [FutureEd](https://www.future-ed.org/students-tried-khanmigos-ai-tutor-most-didnt-want-its-help/) (summary)
- Khan Academy's design response: Khanmigo "is no longer an add-on that requires students to recognize when they need help and understand how to ask for it"; it is embedded in the practice flow and prompts students to explain how they reached an answer; "giving the answer away before a student submitted a response" is tracked as a guardrail metric. [DESIGN] — [Khan Academy blog](https://blog.khanacademy.org/how-we-built-ai-tutoring-tools); [Sal Khan note](https://blog.khanacademy.org/khanmigos-first-chapter-changed-how-i-think-about-ai-a-note-from-sal-khan/) (summary)
- Graduate-level evidence closest to the motivating user: in a graduate mobile-robotics course, 66 students used either a Socratic-guidance tutor or a prompt-refinement tutor for 6 weeks, then 52 used an unconstrained LLM for a 3-week project. Task performance was similar during guided use, but the Socratic group had higher learning gains in later sessions; learners perceived the Socratic tutor as less efficient. [QUASI/RCT — design details unverified] — [arXiv 2607.03303](https://arxiv.org/abs/2607.03303) (summary; verify venue and assignment method)
- "Socratic Gap": in an introductory Python course, prior programming experience moderated the relation between Socratic-conversation length and performance: longer conversations were slightly negative for absolute beginners, positive for students with prior experience. Small sample (95 chat interactions), conference abstract. [QUASI] — [AMCIS 2026 TREO](https://aisel.aisnet.org/treos_amcis2026/74) (summary)
- SocraticAI (Ashoka University): Socratic scaffolds plus required well-formulated questions and daily usage limits; students reportedly moved from vague help requests to precise problem decomposition within 2-3 weeks. No control group. [QUAL] — [arXiv 2512.03501](https://arxiv.org/abs/2512.03501) (summary)
- Lead-and-Reveal (the AI asks the learner to state each step before the matching code is revealed) was, of seven engagement techniques, the one that improved alignment between perceived and actual ability to code without AI (r = .26, p = .017 vs. baseline r = .16, n.s.) without raising task load (59.6 vs. 58.9 NASA-TLX), at 857 s vs. 471 s baseline. Post-test code-writing differences were not significant. V1 complaints: questions lacked context and gave no explanation after wrong answers; V2 complaints: inflexible (n=10), time-consuming (n=9), feedback hard to interpret (n=8). [RCT, N=82 between-subjects then N=42 within-subjects] — [Kazemitabaar et al., IUI 2025](https://arxiv.org/html/2410.08922v1) (read)
- GPT-4 can generate Socratic debugging turns but this was established as a benchmark, not a learning study. [QUASI, no learner outcome] — [Al-Hossami et al. 2023](https://arxiv.org/abs/2310.03210) (summary)
- LLMs drift out of Socratic mode: CS50's duck, instructed not to give code solutions, produced Markdown code blocks in 22% of ~10 million responses and 48% of 1.3 million conversations; moving from GPT-4 to GPT-4o raised message-level rate from 20% to 25% and conversation-level from 44% to 56% ("instruction dilution"). [QUASI, deployment logs] — [Liu et al., "Improving AI in CS50"](https://cs.harvard.edu/malan/publications/fp0627-liu.pdf) (read)
- Khan Academy's CLO reports the same mechanism: when prompts get too long "the model starts randomly ignoring different parts of the instructions". [DESIGN] — [EdWeek interview with Kristen DiCerbo](https://www.edweek.org/technology/opinion-can-an-ai-powered-tutor-produce-meaningful-results/2025/07) (summary)
- Consumer "study modes" (Claude Learning mode April 2025, ChatGPT Study Mode July 2025, Gemini Guided Learning August 2025) all default to questions and stepwise guidance and can be toggled off mid-session; reviewers found no rigorous outcome studies. [DESIGN] — [EdTech Insiders](https://edtechinsiders.substack.com/p/study-modes-the-new-ai-battleground); [Pearson overview](https://pearson.com/international-schools/international-schools-blog/2026/02/what-is-gemini_s-guided-learning-and-chatgpts-study-mode-.html) (summary)

Learner-chosen help level
- Edugator AI TA with an opt-out guardrail: default chatbot explains concepts but gives no code; a "See Solution" button (after starting a chat) returns the corrected code with explanation. 885 students, one graded C lab, three tasks. 50% never clicked it; 18% used it on one problem, 18% on two, 14% on all three. Students who used it on all three averaged 66 on proctored exams versus 73 for non-users (72 and 73 for one- and two-problem users); bottom-quartile students were about twice as likely as top-quartile to use it on all three. Use was not related to procrastination. Reasons for clicking: getting unstuck, checking work, working backward from the answer, time pressure, curiosity. Reasons for not: valuing independent learning, finding the chatbot enough, seeing it as cheating. Correlational. [QUASI] — [arXiv 2504.11146](https://arxiv.org/html/2504.11146v1) (read)
- CodeAid students said explicitly "I would like a hint rather than the answer"; some reported deliberately avoiding the more direct features. [QUAL] — [Kazemitabaar et al., CHI 2024](https://arxiv.org/html/2401.11314v2) (read, first ~60%)

### Inferences
- Socratic questioning is obstructive when (a) the question is one the learner has already answered, (b) the request is a lookup (API name, syntax, error meaning), or (c) wrong answers get no feedback. It appears more productive for learners with prior experience (Socratic Gap, graduate robotics course), which favours it for the CS336 audience — provided it is targeted at design/logic reasoning rather than lookups.
- The Edugator result suggests that an escape hatch used occasionally (one or two of three problems) is not associated with worse outcomes; wholesale use is. That supports a visible hatch plus self-monitoring rather than a hard wall.
- Do not rely on a system prompt alone to hold a no-code policy. CS50's 22-25% leak rate implies output-side enforcement (detect code blocks and re-ask, or a second-pass filter).

### Gaps
- No clean RCT in programming comparing Socratic vs. direct-answer LLM tutoring with a retention test was found. Claims of Socratic superiority rest on the robotics preprint and on adjacent domains.
- The Khanmigo NBER draft was only seen through press coverage; population is middle-school maths.
- Kestin et al.'s Harvard physics AI-tutor RCT was searched for but not retrieved; not cited here.

---

## 3. Explain-my-error and LLM-enhanced compiler/runtime error messages

### Takeaway
Learners like LLM error explanations and use them heavily, but controlled evidence on fix speed is mixed (one null result, two positive), and there is essentially no evidence that they improve learning once the help is withdrawn. Expert-written messages still beat GPT-4 ones.

### Cited Findings
- Santos & Becker: 106 participants, six buggy C programs, each randomly assigned stock GCC 13.2 message, expert-handwritten message, or GPT-4 explanation. GPT-4 beat the stock message on time-to-fix in only 1 of 6 tasks; handwritten explanations outperformed both on objective and subjective measures; students still preferred GPT-4 explanations to stock messages. [RCT, within-subjects] — ["Not the Silver Bullet"](https://arxiv.org/abs/2409.18661v1) (summary)
- Wang, Mitchell & Piech (Stanford, large-scale RCT in CS1): students with real-time GPT-4 error feedback repeated an error 23% less often and resolved it in 36% fewer attempts. Outcome is error resolution during practice, not a post-test. [RCT] — [arXiv 2402.08072](https://arxiv.org/pdf/2402.08072v1) (summary)
- Pankiewicz & Baker: GPT-4 hints for compiler errors in an intro course; when hints were later withheld, the experimental group outperformed control on five of six error types, though overall results were described as mixed. This is the only source found with any transfer-after-removal signal. [RCT/QUASI] — [ITiCSE 2024](https://arxiv.org/abs/2403.12737v1) (summary)
- dcc --help (UNSW): compiler sends source, error location and the standard message to an LLM asked for novice guidance without solutions. Explanations were conceptually accurate in ~90% of compile-time and ~75% of run-time cases, but "often ignored the instruction not to give code solutions"; used over 64,000 times in ten weeks. [QUASI, deployment] — [Taylor et al., SIGCSE 2024](https://arxiv.org/abs/2308.11873v2) (summary)
- Earlier Codex-based work (Leinonen et al.) found LLM-enhanced Python error messages were improvements only about half the time. [QUASI, no learners] — as summarized in [Santos & Becker](https://arxiv.org/pdf/2409.18661) (summary; original not read)
- CodeAid's "Help Fix Code" never displayed fixed code; it was correct 63% of the time and judged helpful 42% of the time — the weakest feature — and was redesigned mid-term to highlight the lines needing change. [QUASI, deployment] — [Kazemitabaar et al., CHI 2024](https://arxiv.org/html/2401.11314v2) (read)
- Shen & Tamkin: "Iterative AI debugging" (repeatedly handing errors to the AI) was one of three low-scoring interaction patterns (quiz <40%); the no-AI control group met a median of 3 errors vs. 1 for the AI group, including more library-specific errors, and the largest quiz gap between groups was on debugging questions. [RCT for the group difference; pattern analysis is associative] — [arXiv 2601.20245](https://arxiv.org/html/2601.20245v1) (read)

### Inferences
- Explain-my-error is a low-risk pattern only if it explains the *message* (what `RuntimeError: shape mismatch` means, where to look) and stops short of the fix. The dcc and CS50 leak rates show this must be enforced on output.
- For CS336-type work the error surface is different: most painful bugs are silent (wrong loss, NaNs, off-by-one in BPE merges) rather than compiler errors. The CS1 evidence transfers poorly; the Shen & Tamkin evidence (professional developers learning an unfamiliar library) is closer and says encountering and resolving errors yourself is where debugging skill forms.
- A reasonable gate: explanation of an error is free; diagnosis of a failing test requires the learner to first state a hypothesis.

### Gaps
- No study found on LLM explanations of ML-specific failures (shape errors, numerical instability, non-converging training).
- Wang et al. language/course details and Pankiewicz & Baker's "mixed" results were not read in full.

---

## 4. Code generation, inline autocomplete, and "friction" designs

### Takeaway
The best causal evidence says AI code generation during a learning task lowers subsequent unassisted skill (d ~ 0.7 in professionals learning a new library) unless the learner uses it for explanation rather than delegation. Ghost-text autocomplete specifically has only qualitative evidence, which is negative for novices (drifting, shepherding, illusion of competence). Most "friction" designs that merely slow the learner (retyping, puzzles, injected bugs) add time and frustration without measurable learning benefit.

### Cited Findings

Generation
- Shen & Tamkin (Anthropic Fellows): 52 developers (>1 year Python, weekly use, no prior Trio), randomized to GPT-4o chat assistant vs. no AI for two async tasks, then a no-AI quiz. AI group scored 4.15 points lower on a 27-point quiz (17%; Cohen's d = 0.738, p = 0.010); no significant speed-up overall; 4 of 26 controls failed to finish task 2 within 35 minutes, all AI participants finished. Control scored higher at every experience level. Authors' caveats: one hour, one library, chat interface only ("agentic tools likely have larger effects"), crowd workers without an incentive to learn. [RCT] — [arXiv 2601.20245](https://arxiv.org/html/2601.20245v1) (read); [Anthropic summary](https://www.anthropic.com/research/AI-assistance-coding-skills)
- Interaction patterns in the AI arm (associative, n=2-7 each): low-scoring (<40%; discussion gives 24-39%) = AI Delegation (n=4), Progressive AI Reliance (n=4), Iterative AI Debugging (n=4); high-scoring (>=65%; 65-86%) = Generation-Then-Comprehension (n=2), Hybrid Code-Explanation (n=3), Conceptual Inquiry (n=7). Conceptual Inquiry (asking only conceptual questions, writing code oneself) was the second-fastest pattern overall. [QUASI] — [arXiv 2601.20245](https://arxiv.org/html/2601.20245v1) (read)
- Type-it-yourself evidence from the same study: 9 participants pasted AI code (fastest), 9 manually retyped it and 4 mixed (about control speed); "Quiz scores did not differ notably between pasting and typing." [QUASI] — [arXiv 2601.20245](https://arxiv.org/html/2601.20245v1) (read)
- Counter-evidence in younger novices: 69 learners aged 10-17, Python from zero, half with Codex over 45 authoring tasks; Codex group had 1.15x completion and 1.8x authoring scores, performed similarly on manual code-modification tasks and on the immediate post-test, and slightly (non-significantly) better on a one-week retention test; learners with higher Scratch pre-test scores benefited significantly. [RCT] — [Kazemitabaar et al., CHI 2023](https://arxiv.org/abs/2302.07427v1) (summary)
- Follow-up thematic analysis (33 of those learners) identified four usage approaches differing in how much was delegated, with retention outcomes depending on approach. [QUAL] — [Kazemitabaar et al., Koli Calling 2023](https://arxiv.org/pdf/2309.14049) (summary; per-approach numbers not retrieved)
- Novice programmers in an ICCE 2025 study: AI-assisted group produced more polished code via repeated prompting; the non-AI group did more decomposition and debugging and had significantly greater post-test gains. [QUASI/RCT] — [ICCE 2025 paper](https://library.apsce.net/index.php/ICCE/article/download/5679/5611/6851) (summary)
- Anthropic's analysis of ~1 million student conversations: computer science is the most over-represented field (reported as 36.8-38.6% of conversations vs. ~5.4% of US bachelor's degrees) and about 47% of conversations were "direct" (answer-seeking with minimal engagement). [QUASI, descriptive] — [Anthropic Education Report](https://www.anthropic.com/news/anthropic-education-report-how-university-students-use-claude) (summary)

Inline autocomplete (ghost text)
- CS1 students using Copilot on a typical assignment showed two patterns: *shepherding* (steering Copilot toward a solution through prompts rather than writing code) and *drifting* (moving from one incorrect suggestion to the next without progress); the authors discuss cognitive and metacognitive difficulties. [QUAL] — [Prather et al., TOCHI 2024](https://arxiv.org/abs/2304.02491v1) (summary)
- "The Widening Gap": 21 lab sessions with observation, interviews and eye tracking; 20 of 21 completed the problem, but students split into those who accelerated (used GenAI to produce code they already intended to write and ignored bad inline suggestions) and those who were hindered; existing metacognitive difficulties persisted, were compounded, and new ones appeared; struggling students ended with an "illusion of competence". [QUAL] — [Prather et al., ICER 2024](https://arxiv.org/abs/2405.17739) (summary)
- Undergraduates on brownfield tasks were 34.9% faster with Copilot (within-subjects, n=10) and reported concerns about not understanding why suggestions worked. [QUASI, tiny sample] — [Shihab et al., ICER 2025](https://arxiv.org/html/2506.10051v1) (summary)
- Engaging in verification loops (actively reviewing generated code) strongly predicted comprehension. [QUASI] — [arXiv 2511.02922](https://arxiv.org/abs/2511.02922) (summary)
- Course policy as practitioner evidence: CS336 "strongly encourage[s]" disabling AI autocomplete while keeping non-AI symbol completion. [DESIGN] — [CS336](https://cs336.stanford.edu/) (read)

Friction designs
- Seven techniques tested against showing AI code directly (N=82, between-subjects; no technique significantly beat baseline on post-test after correction): Guided-Write-Over (retype each AI line with explanations) took 1,033 s vs. 596 s baseline (d = 1.6), raised physical demand, and was called tedious and repetitive with lower performance and perceived learning; Solve-Code-Puzzle (Parsons-style reordering of the AI solution) took 1,055 s (d = 1.7) and was called mentally exhausting and rigid; Verify-and-Review (AI injects 3-4 bugs to find) raised frustration (72.7 vs. 46.7) and confused learners; Interactive-Pseudo-Code and Explain-before-Usage were judged cognitively taxing with limited depth. Lead-and-Reveal (58.3 vs. 31.5 baseline, p = .058) and Trace-and-Predict (54.1) had the best outcome-to-load balance. [RCT] — [Kazemitabaar et al., IUI 2025](https://arxiv.org/html/2410.08922v1) (read)
- Pseudo-code-only responses in a real course: CodeAid (second-year C course, ~700 enrolled, 372 users, 8,132 queries + 1,986 follow-ups) answered with natural language (43% of responses) or pseudo-code with line-by-line explanation (24%) and no code solutions; 79% of sampled responses were correct and 86% of those helpful; "Help Write Code" was 92% correct and 82% helpful yet only 4% of usage. Pseudo-code generation was added at mid-term in response to student demand. [QUASI, deployment] — [Kazemitabaar et al., CHI 2024](https://arxiv.org/html/2401.11314v2) (read)
- CodeHelp (guardrailed, no solution code; 52 students, 12 weeks): ~50% used it weekly, 70% in four or more weeks, 80% agreed it helped them complete their work. [QUAL] — [Liffiton et al.](https://arxiv.org/abs/2308.06921) (summary)
- Guardrail erosion: a 2026 paper argues that guardrails built for educational tools are not equipped for current models' code-generation capability. [DESIGN/QUASI] — [CodeGuard, arXiv 2602.02509](https://arxiv.org/html/2602.02509v1) (summary)
- General friction evidence outside education: cognitive forcing functions reduced over-reliance on AI but were rated less acceptable; a second click to reveal an LLM answer changed behaviour and spilled over into less LLM use even where no friction was applied. [RCT] — [Buçinca et al. 2021](https://arxiv.org/pdf/2102.09692); [arXiv 2407.12804](https://arxiv.org/html/2407.12804v2) (summary)

### Inferences
- "Type it yourself" and "no copy-paste" are not supported as learning mechanisms: retyping AI code added time and physical demand (IUI 2025) and showed no quiz advantage over pasting (Shen & Tamkin). What matters is who did the *thinking* that produced the code, not whose fingers typed it. Showing answers as images or non-copyable diffs is a variant of the same mechanical friction; I found no study of it specifically.
- The productive form of "pseudo-code only" is responding at one level of abstraction above what the learner must produce. For CS336 that means maths/shape-level descriptions and API pointers rather than PyTorch code.
- Ghost-text should be off by default in a student editor. The evidence is qualitative for novices and the course itself advises it; the "accelerator" finding (benefit accrues only when the suggestion matches what the learner already intended) implies that an advanced learner on *new* material is in the novice position for that material. Non-AI symbol completion is uncontroversial.
- The Shen & Tamkin population (experienced developers, unfamiliar library, voluntary, no grade) is the closest available match to an advanced CS336 auditor, and it shows the harm does not disappear with experience.

### Gaps
- No controlled study isolating inline ghost-text completion (on vs. off) with an unassisted exam or retention outcome was found.
- No studies of copy-paste blocking, image-rendered answers, or retype-from-diff as such.
- No long-horizon (multi-week) RCT of AI code generation on skill in adult learners; Shen & Tamkin is one hour.

---

## 5. Review-after-writing rather than generate-before-writing

### Takeaway
Having the AI respond to code the learner has already written (review, failing tests, located-but-unfixed bugs) is the pattern most consistent with the causal evidence, but direct evidence for "AI reviewer" on learning outcomes is thin and mostly experience reports. Feedback that only says "a test failed" is weaker than feedback that locates the issue.

### Cited Findings
- In Shen & Tamkin's AI arm the high-scoring patterns all kept the human as author or verifier: writing code oneself and asking conceptual questions; asking for explanation alongside code; or generating and then interrogating the result. [QUASI] — [arXiv 2601.20245](https://arxiv.org/html/2601.20245v1) (read)
- LLM-Reviewer: an on-demand GitHub Action that reviews student pull requests, used by two cohorts of 100+ Master's students in a capstone; designed to prompt reflection "rather than supplying definitive answers" and framed as a self-regulated-learning scaffold. Experience report, single institution. [QUAL] — [ICSE-SEET 2026](https://arxiv.org/pdf/2604.23251) (summary)
- Prior automated-feedback work: suggestions about the location of an issue, or hints on how to fix it, improve performance over only reporting that a test failed; GPT-3.5 feedback sometimes invented issues. [QUASI] — [arXiv 2407.04873](https://arxiv.org/html/2407.04873v2); [arXiv 2403.09744](https://arxiv.org/pdf/2403.09744) (summary)
- A randomized classroom study (215 students, 6,693 submissions, 17 labs) compared natural-language LLM hints vs. AI-generated failing test cases vs. no AI feedback on incorrect submissions; outcome results were not retrieved. [RCT, results unknown to me] — [arXiv 2606.08807](https://arxiv.org/html/2606.08807v1) (summary)
- CS50 ships review-style tools alongside chat: VS Code extensions for explaining highlighted code and suggesting style improvements; in Fall 2023 75% of students used the tools frequently and 94% found them helpful; ~211,000 users and 10 million queries by November 2024 at ~$1.50 per student per year. [QUAL, deployment] — [Liu et al.](https://cs.harvard.edu/malan/publications/fp0627-liu.pdf) (read)
- A controlled study with 22 novices in an AI pair-programming setup framed the state of evidence as: AI assistants improve novices' performance but have not shown similar gains in learning. [QUASI] — [arXiv 2604.18538](https://arxiv.org/html/2604.18538) (summary)
- Autograder as immediate feedback loop encourages trial-and-error unless regulated: unrestricted autograding produced guessing and rapid resubmission; regression penalties cut submissions 48%; in a randomized comparison on a database-course midterm, submission caps and regression penalties each reduced these behaviours by up to 85%, and students preferred caps. [RCT for behaviour, not learning] — [Baniassad et al., SIGCSE 2021](https://www.cs.ubc.ca/~rtholmes/papers/sigcse_2021_baniassad.pdf); [Lawrence, Foss & Urazova, TOCE 2023](https://unpaywall.org/10.1145%2F3591210) (summary)

### Inferences
- "Review my code" should return observations and questions tied to line ranges (what is wrong or risky and why), never a replacement diff. CodeAid's experience (fix-without-showing-the-fix was their least helpful feature until it highlighted lines) says location is the minimum useful specificity.
- Review should be learner-triggered after a real attempt (a run or a test execution), which also gives a natural attempt gate for hints.
- Hallucinated issues are a real cost for advanced learners who will chase them; a reviewer should cite the line and, where possible, a failing input.

### Gaps
- No study found that directly compares immediate vs. delayed AI feedback on programming learning; the general feedback-timing literature was not retrieved.
- No evidence found on AI as pair-programming *navigator* (human drives, AI comments) with learning outcomes, or on LLM "rubber duck" modes that only listen and ask.
- Evidence that submission limits improve learning (as opposed to reducing guessing) was not found.

---

## 6. Comprehension-forcing patterns

### Takeaway
Predicting behaviour and explaining steps before seeing code are the comprehension-forcing patterns with the best (still modest) experimental support; they cost 2-3x the time and learners resist them when the code is easy. Questions about the learner's own code reliably expose fragile understanding. Teach-back to a simulated novice has promising small-sample results for debugging.

### Cited Findings
- Trace-and-Predict (step through the code on a sample input and predict variable values at key points): post-test 54.1 vs. 31.5 baseline in study 1 (n.s.); in study 2 highest post-test (64.3 vs. 57.6 baseline vs. 55.0 Lead-and-Reveal; n.s.) but the longest time (1,251 s vs. 471 s) and highest task load (67.1 vs. 58.9; temporal demand 75.2 vs. 55.2). Complaints: too many steps, inefficient for simple or long code (n=7), questions too simple or repetitive (n=7), workflow disruption (n=6); 15 of 42 were reluctant to use it. Requested fixes: a skip option, explanations after wrong predictions, fewer and harder questions. [RCT] — [Kazemitabaar et al., IUI 2025](https://arxiv.org/html/2410.08922v1) (read)
- Explain-before-Usage (3-5 short-answer questions about AI code before it can be used) was judged surface-level, with questions about trivial lines. [RCT, qualitative verdict] — [Kazemitabaar et al., IUI 2025](https://arxiv.org/html/2410.08922v1) (read)
- After engagement techniques, learners ran the AI code far less often before understanding it (0.3-1.0 runs vs. 3.9 for baseline), i.e. forced engagement displaced run-and-see. [RCT] — [Kazemitabaar et al., IUI 2025](https://arxiv.org/html/2410.08922v1) (read)
- Questions about learners' own code (QLCs): some students answer even simple questions about their own functionally correct programs incorrectly; in a replication in a second programming course, students who struggled with questions about their own program logic had lower overall course points. [QUASI] — [Lehtinen et al. replication, arXiv 2306.16267](https://arxiv.org/html/2306.16267v1) (summary)
- Automatically generated code-comprehension questions combining unit tests with AI follow-up questions have been integrated into CodeRunner. [DESIGN/QUAL; results not checked] — [Goodfellow et al., 2026](https://strathprints.strath.ac.uk/96355/1/Goodfellow-etal-HCIS-2026-leveraging-generative-AI-to-support-code-comprehension-in-introductory-programming.pdf) (summary)
- Parsons problems as help: CodeTailor generates a personalized Parsons problem from the student's own partial code instead of giving a solution; 18 novices found it engaging and helpful, but some still did not understand the solutions, leading to added multi-level explanations (subgoal, block, atom) and a fill-in self-explanation step. [QUAL] — [Hou et al.](https://arxiv.org/pdf/2401.03144v2); [initial study](https://par.nsf.gov/servlets/purl/10510499) (summary). As post-hoc friction on AI code, the Parsons variant was slow and disliked (see section 4). — [IUI 2025](https://arxiv.org/html/2410.08922v1) (read)
- Teach-back / teachable agents: HypoCompass has the student act as TA for an LLM-simulated novice with buggy code and practise forming bug hypotheses; 19 novices improved pre-to-post by 12% and were 14% faster; LLM generated valid material sets 90% of the time. No control group visible. [QUASI] — [Ma et al.](https://arxiv.org/abs/2310.05292v5) (summary). Teaching ChatGPT as a teachable agent was associated with higher self-efficacy and more self-regulated-learning strategy use. [QUASI] — [Chen & Wei, arXiv 2412.15226](https://web3.arxiv.org/pdf/2412.15226) (summary)
- Self-explanation at the point of help is the direction ITS researchers now recommend over passive hint reading. [DESIGN] — [An et al., LAK 2026](https://www.cs.cmu.edu/afs/cs.cmu.edu/Web/People/bmclaren/pubs/AnEtAl-RevisitingTheHintButton-LAK2026.pdf) (read)
- Plan-level alternative: "Prompt Problems" have students write a prompt that makes an LLM produce a specified input-output transformation; three studies on interaction and perceived learning. [QUAL] — [Denny, Prather et al.](https://arxiv.org/pdf/2401.10759.pdf) (summary)

### Inferences
- Prediction prompts fit ML code unusually well: "what is the shape of `x` after this line?", "what should the loss be at step 0 for a 10k vocabulary?", "which token pair merges next?" are checkable, non-trivial, and cheap to verify by running. This sidesteps the main complaint (trivial questions) from the CS1-level studies.
- Make every comprehension prompt skippable and rate-limited; the IUI study's reluctance figures (15/42) are for a mandatory flow.
- QLCs on the learner's *own passing* code are a good use of an LLM for an advanced learner: tests passing is not understanding, and the questions do not reveal any solution.

### Gaps
- No evidence found on trace tables specifically, or on "explain in plain English" grading by LLMs, despite searching.
- No controlled teachable-agent study in programming with a comparison condition was found.
- All comprehension-forcing studies used short CS1-style functions; none used ML or systems code.

---

## 7. Memory and metacognition patterns

### Takeaway
Retrieval practice with LLM-generated questions has one supportive classroom study in a data-science course; metacognitive calibration is a documented problem that at least one interaction pattern (Lead-and-Reveal) measurably improves. For spaced repetition from one's own code, reflection journals, confidence ratings, and AI-reliance dashboards, I found design proposals but no outcome evidence in programming.

### Cited Findings
- LLM-generated multiple-choice retrieval questions in a data-science course: 89% accuracy on assessment quizzes in weeks with retrieval practice vs. 73% in weeks without; the authors caution that question quality varies and instructors must verify and revise generated questions. [QUASI, within-course comparison] — [An et al., arXiv 2507.05629](https://arxiv.org/html/2507.05629v2) (summary)
- Illusion of competence with AI is observed in novices and persists unnoticed by the learner. [QUAL] — [Prather et al., ICER 2024](https://arxiv.org/abs/2405.17739) (summary)
- Self-reports diverge from outcomes in adults too: the AI group found the task easier, both groups found the quiz equally hard, and the no-AI group reported higher learning. [RCT] — [Shen & Tamkin](https://arxiv.org/html/2601.20245v1) (read)
- Calibration can be designed for: Lead-and-Reveal was the only condition where perceived and actual ability to code without AI were significantly correlated (r = .26, p = .017). [RCT] — [Kazemitabaar et al., IUI 2025](https://arxiv.org/html/2410.08922v1) (read)
- Metacognitive feedback on help-seeking changes behaviour (and in one study persisted a month) but has not been shown to raise domain learning. [RCT/QUASI] — [Roll et al. 2011](https://www.cs.cmu.edu/~bmclaren/pubs/RollEtAl-ImprovingMetacogSkillsWithITS-LandI2010.pdf); [Aleven et al.](https://cris.iucc.ac.il/en/publications/help-helps-but-only-so-much-research-on-help-seeking-with-intelli/) (summary)
- Two log-derived indicators (hint-before-attempt, sub-reading-speed hint click-through) are proposed as "practical candidates for learning analytics dashboards or automated real-time intervention". [DESIGN] — [An et al., LAK 2026](https://www.cs.cmu.edu/afs/cs.cmu.edu/Web/People/bmclaren/pubs/AnEtAl-RevisitingTheHintButton-LAK2026.pdf) (read)
- Active coding time correlated with quiz score in the no-AI group; AI users spent much less active time coding. [QUASI] — [Shen & Tamkin](https://arxiv.org/html/2601.20245v1) (read)
- Usage caps as a metacognitive device: SocraticAI imposes daily usage limits and requires well-formulated questions. No controlled evaluation. [DESIGN/QUAL] — [arXiv 2512.03501](https://arxiv.org/abs/2512.03501) (summary)

### Inferences
- A reliance dashboard for a self-motivated learner is well motivated (self-perception is demonstrably miscalibrated; cheap indicators exist) but untested. Candidate metrics grounded in the sources: share of help requests made before any run/attempt; highest hint rung reached per problem; escape-hatch uses per assignment (Edugator: occasional use benign, blanket use associated with lower exam scores); active typing time; errors encountered and self-resolved.
- Retrieval questions generated from the learner's own bugs ("last week your BPE merged across word boundaries — why is that wrong?") combine QLC and retrieval-practice evidence, but generated questions need a correctness check; for a solo learner there is no instructor to vet them.
- For a voluntary learner, usage caps are more plausible as a self-set commitment than as an imposed limit.

### Gaps
- No controlled study of spaced repetition in a programming course, or of cards generated from a learner's own code/mistakes.
- No studies of confidence ratings, learning journals, or mastery/progress models in LLM programming tools were retrieved.
- No evaluation of AI-usage dashboards shown to learners was found.
- The CS50 duck's reported per-student question throttle ("hearts" that regenerate over time, described in the earlier SIGCSE 2024 CS50 paper) could not be verified in the sources I read and is therefore not cited.

---

## 8. Test-first and scaffold patterns

### Takeaway
Provided test suites and human-writes-the-core scaffolds are widely used and fit the causal evidence about authorship, but they are supported mainly by design practice, not outcome studies. Planning-before-coding with LLM feedback has a known pitfall: the model silently repairs a deficient plan.

### Cited Findings
- CS336's own structure is test-first with minimal scaffolding: all tests initially fail with `NotImplementedError`, the student wires implementations through `tests/adapters.py`, and the course states students get "minimal scaffolding". [DESIGN] — [assignment1-basics](https://github.com/stanford-cs336/assignment1-basics); [CS336](https://cs336.stanford.edu/) (read)
- Claude Code's built-in "Learning" output style: adds explanatory "Insight" blocks and "asks you to write some of the code"; it "marks the spot with a TODO(human) comment in the file, then sends a request that says what's already built, what to write, and what to weigh", then waits. "Explanatory" style explains implementation choices without handing over code-writing. Both use more output tokens. No outcome evaluation is published in the docs. [DESIGN] — [Claude Code output styles](https://code.claude.com/docs/en/output-styles) (summary of official docs)
- Planning with LLM feedback (Brown): students write a plan, an LLM turns it into code, and the code is run against a small staff-written test suite (up to 5 examples per problem) whose results are shown to the student. Failure modes: false positives where a deficient plan passed because the LLM filled gaps, and the LLM inventing unspecified details when given too much problem context. [QUAL/QUASI] — [Rivera, Fisler & Krishnamurthi, ITiCSE 2024](https://cs.brown.edu/~sk/Publications/Papers/Published/rsfk-planning-w-gpt-feedback/paper.pdf) (summary)
- Learner-led decomposition: DBox has the learner build the step tree and the LLM scaffold only when needed; within-subjects study with 24 learners. [QUASI] — [DBox, arXiv 2502.19133](https://arxiv.org/html/2502.19133v1) (summary; outcome numbers not retrieved)
- A thesis argues decomposition planned before implementation beats on-the-fly or post-hoc decomposition for novices. [DESIGN/QUAL] — [Chopra, TU Delft 2025](https://repository.tudelft.nl/file/File_5bc74264-d5ed-4dec-bcfd-7d1d57fad26d?preview=1) (summary)
- Non-AI learners did more decomposition and debugging and had greater post-test gains than AI-assisted learners. [QUASI/RCT] — [ICCE 2025](https://library.apsce.net/index.php/ICCE/article/download/5679/5611/6851) (summary)
- Test suites invite trial-and-error unless submissions are limited or regressions penalized (see section 5); students in one engineering course reported hidden autograder tests did not help them build independent debugging skill. [RCT for behaviour; QUAL] — [Lawrence et al. 2023](https://unpaywall.org/10.1145%2F3591210); [ASEE paper](https://nemo.asee.org/public/conferences/327/papers/40146/download) (summary)
- Checking autograder feedback between consecutive submissions is associated with improved next-submission scores (five community colleges, observational). [QUASI] — [arXiv 2507.14235](https://arxiv.org/pdf/2507.14235) (summary)
- Fading matters for stronger learners: slow fading of worked steps suits low-prior-knowledge learners, fast fading or immediate problem solving suits high-prior-knowledge learners; adaptive fading beat fixed fading in tutored problem solving. [RCT, non-programming] — [Salden, Aleven, Schwonke & Renkl 2010](https://link.springer.com/doi/10.1007/s11251-009-9107-8); [expertise reversal overview](https://en.wikipedia.org/wiki/Expertise_reversal_effect) (summary)

### Inferences
- For CS336 the "core" the human must write is nearly everything graded (tokenizer, attention, optimizer, training loop); the AI-writes-boilerplate split of TODO(human) inverts for this course. The legitimate AI-written surface is narrow: plotting scripts, CLI argument parsing, logging, experiment configs — and even there the learner should opt in per file.
- The editor's primary feedback loop should be the course's own tests, surfaced prominently, with AI help keyed to a specific failing test. Local tests are unlimited, so trial-and-error is possible; a soft prompt ("state what you changed and why" after N rapid reruns) is the analogue of a regression penalty, untested.
- Plan-first help should critique the plan as text (missing cases, wrong invariants) and must not generate code from it, to avoid the Brown false-positive problem.
- Expertise-reversal evidence argues against heavy skeleton code with many TODOs for this learner; the course already chose minimal scaffolding.

### Gaps
- No outcome study of the TODO(human) / human-writes-core pattern was found.
- No study found on whether provided test suites (vs. writing one's own tests) help or hurt learning in advanced courses.
- DBox outcome data not read.

---

## 9. Learner control vs. enforced guardrails; escape hatches

### Takeaway
Strict no-answer guardrails prevent the measured harm of unrestricted AI but do not by themselves produce learning gains, and in voluntary settings they push learners to disengage or switch tools. Optional guardrails are used responsibly by many learners, with heavy bypass concentrated among weaker ones. No study directly compares strict vs. adjustable limits on learning, and none targets self-regulated adults using commitment devices.

### Cited Findings
- Strict guardrail benefit: hint-only GPT Tutor removed the 17% exam penalty seen with unrestricted GPT Base, while not exceeding the no-AI control. [RCT] — [Bastani et al.](https://papers.ssrn.com/abstract=4895486) (summary)
- Strict guardrail cost in the wild: most students declined a Socratic no-answer tutor most of the time. [QUASI via press] — [KQED](https://www.kqed.org/mindshift/66662/students-didnt-get-answers-from-khanmigo-they-didnt-want-its-questions-either) (summary)
- The motivation for optional guardrails given in the literature is that overly restrictive ones lead students to bypass course tools for unconstrained models; the Edugator paper cites this but did not itself measure switching. [DESIGN, citing prior work] — [arXiv 2504.11146](https://arxiv.org/html/2504.11146v1) (read)
- Optional guardrail behaviour (Edugator, 885 students): half never used "See Solution"; all-problem users were disproportionately bottom-quartile and scored 66 vs. 73 on proctored exams; first-day starters were less likely to use it (65% did not); usage was independent of start time otherwise. Authors: solution-seeking "may reflect a need for help rather than cause poorer performance". [QUASI] — [arXiv 2504.11146](https://arxiv.org/html/2504.11146v1) (read)
- Experimenters could not keep a no-AI control group AI-free on one crowd platform: ~35% of controls used AI in pilot A, ~25% in pilot B despite warnings. [QUASI] — [Shen & Tamkin](https://arxiv.org/html/2601.20245v1) (read)
- Guardrails leak technically: CS50 duck 22-25% of responses with code blocks; dcc --help often ignored the no-solution instruction. [QUASI] — [Liu et al.](https://cs.harvard.edu/malan/publications/fp0627-liu.pdf) (read); [Taylor et al.](https://arxiv.org/abs/2308.11873v2) (summary)
- Learners want control and transparency: one of CodeAid's four design considerations is "maintaining transparency and control for students to assess and steer AI responses". [DESIGN from deployment] — [Kazemitabaar et al., CHI 2024](https://arxiv.org/abs/2401.11314) (summary)
- Friction changes behaviour beyond where it is applied and lowers acceptance. [RCT, non-education] — [arXiv 2407.12804](https://arxiv.org/html/2407.12804v2); [Buçinca et al.](https://arxiv.org/pdf/2102.09692) (summary)
- Lack of flexibility was the top complaint about the best-performing engagement technique (10 of 42). [RCT, qualitative] — [IUI 2025](https://arxiv.org/html/2410.08922v1) (read)
- Mode toggles are the industry default: study modes in ChatGPT, Gemini and Claude can be switched off mid-session. [DESIGN] — [EdTech Insiders](https://edtechinsiders.substack.com/p/study-modes-the-new-ai-battleground) (summary)

### Inferences
- For a voluntary learner with every unrestricted tool one alt-tab away, a hard wall is not enforceable; the editor's guardrails function as a commitment device the learner chose. The design goal shifts from prevention to making the bypass deliberate, visible, and recorded.
- Escape-hatch properties suggested by the evidence: available only after an attempt (LAK 2026 indicator), scoped to one failing test or function rather than the whole assignment (Edugator's per-problem pattern), preceded by a one-line statement of what the learner tried, followed by a comprehension step on the revealed material (IUI 2025 Lead-and-Reveal / QLC), and logged to the reliance view. Each element is individually motivated; the combination is untested.
- Per-session mode toggles are the weakest form of guardrail. A commitment set per assignment (e.g. "no code from the assistant for assignment 1") is closer to a commitment device, but I found no evidence comparing the two.

### Gaps
- No RCT comparing strict vs. learner-adjustable guardrails on learning.
- No evidence on commitment devices, self-set budgets, or cooling-off timers for AI help among adult self-directed programmers.
- No measured rate of students leaving a guardrailed course tool for ChatGPT-class tools in the sources read.

---

## 10. What to deliberately NOT include

### Takeaway
The evidence most clearly argues against: one-click whole-solution generation inside the learning task, AI ghost-text completion, a hint button that bottoms out in the learner's exact answer with no attempt gate, "fix it for me" on errors, and mechanical friction (retyping, puzzle reassembly, injected bugs) presented as pedagogy. It also argues against mandatory, unskippable Socratic or quiz gates.

### Cited Findings
- Unrestricted generation during learning lowered later unassisted performance in two randomized studies (d = 0.738 in developers; -17% exam in high-school maths). — [Shen & Tamkin](https://arxiv.org/html/2601.20245v1) (read); [Bastani et al.](https://papers.ssrn.com/abstract=4895486) (summary)
- Delegating debugging to the AI was a low-learning pattern and the largest quiz deficit was in debugging. — [Shen & Tamkin](https://arxiv.org/html/2601.20245v1) (read)
- AI autocomplete is discouraged by the target course and qualitatively linked to drifting and illusion of competence in novices. — [CS336](https://cs336.stanford.edu/) (read); [Prather et al. 2024](https://arxiv.org/abs/2304.02491v1); [Prather et al. ICER 2024](https://arxiv.org/abs/2405.17739) (summary)
- Bottom-out-on-demand hint buttons are consistently associated with poorer outcomes when used before attempting. — [An et al., LAK 2026](https://www.cs.cmu.edu/afs/cs.cmu.edu/Web/People/bmclaren/pubs/AnEtAl-RevisitingTheHintButton-LAK2026.pdf) (read)
- Retyping AI code, re-ordering AI code as a puzzle, and hunting AI-injected bugs cost 1.5-1.8x time and raised physical demand or frustration with no significant learning benefit. — [Kazemitabaar et al., IUI 2025](https://arxiv.org/html/2410.08922v1) (read)
- Always-abstract first hints can mislead and annoy. — [Xiao et al. 2024](https://arxiv.org/html/2404.02213v1) (read)
- Unskippable question flows drew reluctance (15/42) and inflexibility complaints (10/42); forced-Socratic tutors were abandoned in the field. — [IUI 2025](https://arxiv.org/html/2410.08922v1) (read); [KQED](https://www.kqed.org/mindshift/66662/students-didnt-get-answers-from-khanmigo-they-didnt-want-its-questions-either) (summary)
- Prompt-only guardrails are unreliable (22-25% leakage at CS50). — [Liu et al.](https://cs.harvard.edu/malan/publications/fp0627-liu.pdf) (read)
- Unverified LLM review comments and generated quiz questions can be wrong (CodeAid 79% correct overall, 63% for fix help; GPT-3.5 invented issues; retrieval questions needed instructor vetting). — [CodeAid](https://arxiv.org/html/2401.11314v2) (read); [arXiv 2403.09744](https://arxiv.org/pdf/2403.09744); [arXiv 2507.05629](https://arxiv.org/html/2507.05629v2) (summary)

### Inferences
- Also plausibly excluded on the authors' own extrapolation rather than data: agentic "implement this file / make the tests pass" modes. Shen & Tamkin state agentic tools likely have larger effects than the chat interface they tested; no direct learner study was found.
- "Do not include" for this audience is better expressed as "off by default, on only through a deliberate, logged action", because an advanced auditor has legitimate non-learning chores (plots, configs) and will otherwise leave the tool.
- Avoid gamified hint currencies and point costs: no evidence found either way, and the ITS record shows help-regulation mechanics change behaviour without improving learning.

### Gaps
- No direct evidence on agentic coding modes and learning.
- No evidence on whether excluding features causes advanced voluntary learners to abandon a learning-focused editor; the abandonment evidence is from middle-school maths.

---

## Cross-cutting note: transfer from CS1 novices to an advanced, voluntary CS336 learner

### Takeaway
Most pattern-level evidence is from CS1 or K-12; the few adult/advanced sources (Shen & Tamkin's developers, the graduate robotics tutor study, expertise-reversal work) suggest the harm from delegation transfers upward, while the need for heavy scaffolding and rigid hint ladders does not.

### Cited Findings
- Harm from AI assistance on skill formation held at every experience level among working developers learning an unfamiliar library. [RCT] — [Shen & Tamkin](https://arxiv.org/html/2601.20245v1) (read)
- Learners with higher prior competency benefited more from (or were less harmed by) AI code generation in a 10-17-year-old sample. [RCT subgroup] — [Kazemitabaar et al., CHI 2023](https://arxiv.org/abs/2302.07427v1) (summary)
- Students who accelerated with GenAI used it to produce code they already intended to write. [QUAL] — [Prather et al., ICER 2024](https://arxiv.org/abs/2405.17739) (summary)
- Socratic interaction was more productive for students with prior experience, and produced better later learning in a graduate course while feeling less efficient. [QUASI] — [AMCIS 2026](https://aisel.aisnet.org/treos_amcis2026/74); [arXiv 2607.03303](https://arxiv.org/abs/2607.03303) (summary)
- Unproductive hint use is concentrated in lower-prior-knowledge learners; strong students sometimes use bottom-out hints productively as worked examples. [QUASI] — [An et al., LAK 2026](https://www.cs.cmu.edu/afs/cs.cmu.edu/Web/People/bmclaren/pubs/AnEtAl-RevisitingTheHintButton-LAK2026.pdf) (read)
- High-prior-knowledge learners do better with fast fading or direct problem solving than with extended worked examples. [RCT, non-programming] — [Salden et al. 2010](https://link.springer.com/doi/10.1007/s11251-009-9107-8) (summary)
- Shen & Tamkin's participants "lacked the job incentive to learn the library" — i.e. a no-stakes population still showed the effect, but motivation to learn was not manipulated. [RCT limitation] — [arXiv 2601.20245](https://arxiv.org/html/2601.20245v1) (read)

### Inferences
- Likely to transfer: delegation lowers learning; debugging skill forms by hitting and resolving errors yourself; self-assessment of learning with AI is unreliable; conceptual-question use of AI is both fast and high-learning.
- Likely not to transfer: need for syntax-level hints and enhanced compiler messages; tolerance for step-by-step tracing of simple code; the assumption that grade pressure drives answer-seeking (for an auditor the pressure is time and frustration); novice inability to judge hint correctness (advanced learners can spot bad low-level hints, but can be misled on unfamiliar ML specifics).
- An advanced learner on genuinely new material (e.g. first time implementing AdamW or RoPE) is a novice *for that concept*; expertise-reversal logic applies per topic, not per person.

### Gaps
- No study of AI tutoring or guardrail patterns in a from-scratch ML systems course was found.
- No study of voluntary, ungraded adult learners using guardrailed coding tools over weeks.
