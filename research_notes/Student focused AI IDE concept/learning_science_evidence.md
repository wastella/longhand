# Learning-science evidence on AI assistance, learning to program, and skill formation (as of November 2026)

Evidence labels used throughout: **[RCT]** randomized experiment; **[QUASI]** quasi-experimental / natural experiment; **[OBS]** observational, correlational, qualitative or survey; **[META]** meta-analysis; **[THEORY]** prediction from established learning science rather than a direct test with AI.

Verification labels: "primary" means I read the figure in the paper's own text this session; "secondary" means it came from a search-result summary, press coverage or a third-party page and was not checked against the paper.

---

## 1. What do controlled studies show about AI assistance and skill acquisition?

### Takeaway
The best causal evidence converges on a dissociation: unrestricted AI help reliably raises performance on the assisted task while leaving unassisted learning flat or lower (Anthropic: d = 0.74 lower quiz score; Bastani: 17% lower exam score; programming meta-analysis: g = -0.06 when AI is not allowed at the exam). Purpose-built tutors that withhold answers avoid the harm and occasionally produce gains (Kestin: 0.63 SD), but those positive results come from tightly scaffolded, expert-authored systems on short, lower-Bloom tasks with immediate post-tests.

### Cited Findings

**Anthropic: Shen & Tamkin, "How AI Impacts Skill Formation" (arXiv 2601.20245, Jan 2026) [RCT, preprint, industry-authored]**
- Design: 52 analyzed participants (26 AI, 26 control); 53 completed, 1 disqualified under preregistered criteria. Crowd-worker developers paid a flat $150; inclusion required >1 year of Python, weekly Python use, prior AI-assistant use, no prior Trio use. Most were experienced: 29 of 52 reported 7+ years coding, 19 reported 4-6 years, 4 reported 1-3 years (primary) — [arXiv HTML](https://arxiv.org/html/2601.20245v1)
- Note on "junior": Anthropic's blog describes the sample as "52 (mostly junior) software engineers", which sits awkwardly with the paper's Table 1 showing most had 4+ years of experience — [Anthropic research page](https://www.anthropic.com/research/AI-assistance-coding-skills); [arXiv HTML](https://arxiv.org/html/2601.20245v1)
- Task: two tasks using the Python Trio async library within a 35-minute cap, then a 14-question, 27-point quiz covering debugging, code reading and conceptual questions (no code-writing items). AI arm used a GPT-4o chat assistant with access to the participant's code; control could use web search and instructions but no AI (primary) — [arXiv HTML](https://arxiv.org/html/2601.20245v1)
- Main result: 4.15-point difference in mean quiz score on the 27-point quiz, Cohen's d = 0.738, p = 0.01; adjusted for warm-up time d = 0.725, p = 0.016. The paper describes this as 17% or about two grade points (primary). Group means appear only in figures; secondary sources give about 50% (AI) versus 65-67% (control) — [arXiv HTML](https://arxiv.org/html/2601.20245v1); [Anthropic research page](https://www.anthropic.com/research/AI-assistance-coding-skills)
- Largest gap was on debugging questions; smallest on code reading. Control scored higher at every experience level (primary) — [arXiv HTML](https://arxiv.org/html/2601.20245v1)
- No significant speed-up from AI in the main study. Secondary summaries give about 23 minutes (AI) versus 25 (control), p = 0.391. Four control participants did not finish task 2 in 35 minutes; all AI participants did — [arXiv HTML](https://arxiv.org/html/2601.20245v1); [Anthropic research page](https://www.anthropic.com/research/AI-assistance-coding-skills)
- Errors: median errors per participant were 1.0 (IQR 0-3) with AI versus 3.0 (IQR 2-5) in control. Of 12 participants with zero errors on both tasks, only 2 were controls. Control participants hit Trio-specific errors (un-awaited coroutine RuntimeWarning, TypeError from passing a coroutine) and the authors argue that resolving these independently is what built the skill (primary) — [arXiv HTML](https://arxiv.org/html/2601.20245v1)
- Self-report: control rated their own learning higher; AI participants found the task easier but rated the quiz equally difficult. Comments from the AI arm included "I feel like I got lazy" and "there are still a lot of gaps in my understanding" (primary) — [arXiv HTML](https://arxiv.org/html/2601.20245v1)
- Pilots: two early pilots (n=39, n=107) were compromised because 25-35% of control participants used AI anyway. Pilot D (n=20) found AI faster (d = 1.11, p = 0.03) and worse on the quiz (d = 1.7, p = 0.003) (primary) — [arXiv HTML](https://arxiv.org/html/2601.20245v1)
- Authors' stated limitations: single task, chat interface only (agentic tools may offload more), one-hour horizon, no job incentive to learn, quiz-only outcome, small clusters (primary) — [arXiv HTML](https://arxiv.org/html/2601.20245v1)
- External critique: the quiz was taken immediately after a 35-minute task, so it measures short-term retention rather than durable skill formation — [independent blog critique](https://smbadiwe.github.io/post/skill-tax-of-ai-coding)

**Bastani et al., "Generative AI without guardrails can harm learning" (PNAS vol. 122, 2025) [RCT, field]**
- Nearly a thousand Turkish high-school math students. Practice-session grades rose 48% with GPT Base (a ChatGPT-like interface) and 127% with GPT Tutor (prompted to give hints, not answers) (secondary; consistent across abstract listings) — [RePEc/PNAS listing](https://econpapers.repec.org/RePEc:nas:journl:v:122:y:2025:p:e2422633122); [SSRN](https://papers.ssrn.com/abstract=4895486)
- When access was removed, GPT Base students scored 17% worse than control on the unassisted exam. GPT Tutor students scored about the same as control: the harm was mitigated, but there was no net learning gain despite the 127% practice boost — [Wharton summary](https://knowledge.wharton.upenn.edu/article/without-guardrails-generative-ai-can-harm-education/); [SSRN](https://papers.ssrn.com/abstract=4895486)
- Authors' mechanism: students used GPT Base as a "crutch" during practice — [SSRN](https://papers.ssrn.com/abstract=4895486)

**Kestin et al., "AI tutoring outperforms in-class active learning" (Scientific Reports 15:17458, June 2025) [RCT, crossover]**
- Harvard intro physics for life-science students (PS2), Fall 2023. 194 eligible of 233 enrolled; crossover over two consecutive weekly lessons (surface tension, fluid flow); randomized as peer-instruction groups of 2-3 rather than individually. Analysis N = 142 (AI) and 174 (in-class) (primary) — [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/)
- Median post-test 4.5 (AI) versus 3.5 (in-class), from a pre-test baseline of 2.75; effect size 0.63 by linear regression (p < 10^-8), 0.73-1.3 SD by quantile regression to address ceiling effects. Median time on task was 49 minutes for AI versus about 60 in class (primary) — [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/)
- The tutor was heavily engineered: GPT-4 with a system prompt on active engagement, cognitive load and growth mindset; the platform enforced step-by-step sequencing because the prompt alone did not; expert-written step-by-step solutions were embedded so the model never generated solutions itself; several months of development (primary) — [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/)
- Limits stated by authors: post-test was immediate with no retention measure; content sat at the understand/apply/analyze levels and they do not expect the result to hold for complex synthesis; single course; tests did not count toward grades (primary) — [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/)

**Harvard CS50 Duck: Liu, Zenke, Liu, Holmes, Thornton, Malan, "Teaching CS50 with AI" (SIGCSE 2024) [OBS, experience report, no control group]**
- No learning outcome was measured and there was no comparison group; the evidence is usage logs, satisfaction surveys and a small accuracy audit (primary) — [paper PDF](https://cs.harvard.edu/malan/publications/V1fp0567-liu.pdf)
- Guardrails: system prompts designed to guide rather than give solutions; a "hearts" throttle (10 hearts, one regained every three minutes, one consumed per interaction), justified both by cost and as a nudge toward more deliberate questions (primary) — [paper PDF](https://cs.harvard.edu/malan/publications/V1fp0567-liu.pdf)
- Fall 2023 surveys of about 500 on-campus students: mid-semester 17% used the tools more than ten times a week and 32% used them 5-10 times; 47% rated them "very helpful"; 35% "very effective" and 35% "effective" for learning. End of semester (73% response): 50% used them "frequently" and 28% "constantly"; 53% "loved" them (primary) — [paper PDF](https://cs.harvard.edu/malan/publications/V1fp0567-liu.pdf)
- Accuracy audit, Summer 2023: 22 of 25 (88%) curricular answers on the Ed forum were correct. In Fall 2023 only 70 of 180 Ed answers were staff-endorsed (39%), which the authors argue understates accuracy (primary) — [paper PDF](https://cs.harvard.edu/malan/publications/V1fp0567-liu.pdf)
- Scale: more than 50,000 unique users and 1.8 million queries by December 2023; about $1.90 per student per month. Acknowledges support from Ed, GitHub, Microsoft and OpenAI (primary) — [paper PDF](https://cs.harvard.edu/malan/publications/V1fp0567-liu.pdf)
- Guardrail leakage: in a 2026 Harvard Gazette interview Malan is reported as saying the Duck still returns blocks of code up to a quarter of the time despite explicit instructions not to (secondary) — [Harvard Gazette](https://news.harvard.edu/gazette/story/2026/09/taming-the-duck-for-starters/)

**Kazemitabaar et al., CHI 2023 (Codex with novices) [RCT, lab, multi-session]**
- 69 novices aged 10-17 worked on 45 Python code-authoring tasks, half with Codex, each followed by a manual code-modification task; an immediate post-test and a retention test one week later — [arXiv 2302.07427](https://arxiv.org/abs/2302.07427)
- Codex raised authoring performance (1.15x completion rate, 1.8x scores) without lowering performance on manual modification tasks. On the retention test the Codex group was slightly better but not significantly so. Learners with higher Scratch pre-test scores did significantly better on retention if they had had Codex — [arXiv 2302.07427](https://arxiv.org/abs/2302.07427)
- Rated high risk of bias in the 2026 Maier et al. meta-analysis — [Maier et al.](https://arxiv.org/html/2605.04779v1)

**Kazemitabaar et al., CodeAid, CHI 2024 [OBS, deployment]**
- An LLM assistant designed not to reveal code, deployed for a 12-week semester in a C/systems course of about 700 students; more than 8,000 interactions, weekly surveys, 22 interviews. Students mostly used it for conceptual understanding and debugging, a minority tried to extract direct code, and educators worried about incorrect feedback and students defaulting to ChatGPT. No controlled learning outcome — [arXiv 2401.11314](https://arxiv.org/abs/2401.11314)

**Lehmann, Cornelius & Sting, "AI Meets the Classroom: When Do Large Language Models Harm Learning?" (arXiv 2409.09047v2) [QUASI field + two preregistered lab RCTs, Python]**
- Lab Study 2 (n=107) and Study 3 (n=69, exact replication with copy-paste enabled), German university students: 45-minute learning phase with ChatGPT available to the treatment group, then an unassisted post-test. No significant overall effect of LLM access in either (Study 2 p = 0.580; Study 3 p = 0.298) (primary) — [arXiv HTML](https://arxiv.org/html/2409.09047v2)
- Field study: two graduate-level Python courses at a Dutch university (56 and 57 students; 6,594 student-question observations), using similarity to ChatGPT output as a usage proxy and ChatGPT outages as an instrument. Cumulative ChatGPT-similar submissions predicted lower later grades (FE2SLS -0.06, p = 0.002) (primary) — [arXiv HTML](https://arxiv.org/html/2409.09047v2)

**Bassner et al., TUM, "Less stress, better scores, same learning" (Computers and Education: AI, vol. 10) [RCT, three-arm, CS1]**
- N = 275 in an introductory programming course: hint-only AI tutor (Iris) versus unrestricted ChatGPT versus no-AI control with web resources. Both AI arms scored significantly higher on the programming exercise; neither showed significantly greater conceptual learning or code comprehension than control. AI users reported lower frustration and cognitive load; only the tutor raised intrinsic motivation; the authors describe unrestricted AI as a "comfort trap" (secondary, from the lab's own summary page; numeric results not seen) — [TUM EdTech summary](https://www.edtech.tum.de/?p=3520)

**Contractor & Reyes, "Experimental Evidence on the Learning Impact of Generative AI" (arXiv 2607.08849v2, Oct 2026) [RCT, proctored; essay-based, not programming]**
- 211 Middlebury undergraduates (205 at follow-up), 35 minutes to learn an unfamiliar topic and write an essay with or without ChatGPT (GPT-4o), then unaided tests immediately and one week later. Intent-to-treat: +0.28 SD on the immediate test (p = 0.021) and +0.21 SD one week later (p = 0.068). Preregistered (AEA RCT Registry 15806); funded by the college's provost office (primary; some figures in the HTML were garbled) — [arXiv HTML](https://arxiv.org/html/2607.08849v2)
- This is the main recent counter-example: off-the-shelf AI produced a positive learning effect. The task was learning facts about a topic through reading, where AI functions as a research aid, rather than acquiring a procedural skill (primary) — [arXiv HTML](https://arxiv.org/html/2607.08849v2)

**Meta-analyses**
- Maier, Gunzenhäuser, Schweisthal, Schneider & Feuerriegel (arXiv 2605.04779, May 2026), preregistered, programming only. Learning: 10 studies, 11 effect sizes, 1,069 participants; pooled Hedges' g = 0.14 (95% CI -0.18 to 0.47, p = 0.389), I² = 86%. The decisive moderator was exam environment: g = -0.06 (CI -0.36 to 0.24) when GenAI was not allowed at the exam versus g = 0.76 (CI 0.24 to 1.28) when it was. Interface, language, duration, educational level and randomization were not significant moderators (primary) — [arXiv HTML](https://arxiv.org/html/2605.04779v1)
- Same paper, productivity: 14 studies, g = 0.33 (CI 0.09 to 0.58), concentrated in lab settings (g = 0.73) and absent in enterprise (g = 0.19, n.s.) and open-source (g = 0.01, n.s.) settings. 59.3% of all effect sizes were rated higher risk of bias (primary) — [arXiv HTML](https://arxiv.org/html/2605.04779v1)
- A broader 2025 meta-analysis of 133 studies across education reported strong effects when LLMs act as tutors in sustained interventions (secondary) — [arXiv 2509.22725](https://arxiv.org/pdf/2509.22725v2)

**MIT, Kosmyna et al., "Your Brain on ChatGPT" (arXiv, June 2025) [small lab experiment, EEG, essay writing, preprint]**
- 54 participants in three groups of 18 (LLM, search engine, brain-only) across three essay sessions; only 18 participants took part in the optional fourth crossover session. Posted before peer review — [Scientific American](https://www.scientificamerican.com/article/does-using-chatgpt-really-change-your-brain-activity/); [The Decoder](https://the-decoder.com/mit-study-shows-cognitive-debt-through-chatgpt-heres-what-it-means-in-real-world-practice/)
- A published commentary argues for more conservative interpretation: small sample, reproducibility concerns, unclear criteria for a "significant connection" in the EEG analysis, and a confounded crossover design — [arXiv 2601.00856](https://arxiv.org/abs/2601.00856v1)
- The authors' own caveats: only connectivity was analyzed, EEG has limited spatial resolution, only ChatGPT was tested; the lead author has said the study did not show "dumbness in the brain" — [MIT Media Lab project page](https://www.media.mit.edu/projects/your-brain-on-chatgpt/overview/); [Scientific American](https://www.scientificamerican.com/article/does-using-chatgpt-really-change-your-brain-activity/)

**Microsoft/CMU, Lee et al., CHI 2025 [OBS, self-report survey, industry-authored]**
- 319 knowledge workers contributed 936 first-hand examples of GenAI use. Higher confidence in GenAI was associated with less critical thinking; higher task-specific self-confidence with more. GenAI shifted critical thinking toward verification, response integration and task stewardship. All outcomes are self-reported perceptions, not measured skill — [Microsoft Research](https://www.microsoft.com/en-us/research/?p=1135061); [author-hosted PDF](https://advait.org/files/lee_2025_ai_critical_thinking_survey.pdf)

### Inferences
- The single most robust pattern across Anthropic, Bastani, Bassner, Lehmann and the Maier meta-analysis is that assisted-task performance is not evidence of learning. An editor for a student who must write the code should treat task completion as an untrustworthy signal and measure something unassisted.
- "Guardrailed tutor" evidence is asymmetric: guardrails reliably remove harm (Bastani GPT Tutor, Bassner Iris) but mostly reach parity with no AI, not superiority. Kestin's large gain is the exception and came with expert-authored solutions and enforced sequencing, which a general-purpose assistant for a from-scratch LLM course does not have.
- The Anthropic study is the closest match to the CS336 use case (experienced Python programmers learning an unfamiliar library), and it found harm even in that population, concentrated in debugging ability. Debugging one's own implementation is central to a build-from-scratch course.
- Contractor & Reyes suggests the sign of the effect depends on what the task trains. Where AI replaces a search-and-read step, learning can improve; where it replaces the generative step that is itself the skill (writing and debugging code), learning falls.

### Gaps
- Bastani et al.: exact N, effect sizes in SD units and confidence intervals were not read from the PNAS full text; figures here come from abstracts and the Wharton summary.
- Anthropic study: group mean quiz scores and SDs are reported only in figures; 4.15 of 27 points is about 15 percentage points, and I could not reconcile that with the "17%" headline from the text alone (it may be a difference of the group percentage means, 50% versus 67%, quoted in secondary summaries).
- TUM/Bassner: no numeric effect sizes, post-test instrument or duration were verified; the summary page conflicts slightly on publication year (2026 listing, 2025 DOI).
- CS50: I found no controlled evaluation of the Duck's effect on learning outcomes, in the SIGCSE 2024 paper or in follow-ups located this session. Follow-up CS50 papers were not retrieved.
- Kazemitabaar et al.'s later controlled work on cognitive-engagement techniques for AI-generated code (reported in a secondary summary as seven techniques, with "Lead-and-Reveal" best aligning perceived and actual ability) could not be verified against a primary source — [secondary summary](https://warwick.ac.uk/fac/cross_fac/eduport/edufund/projects/yang/projects/exploring-the-design-space-of-cognitive-engagement-techniques-with-ai-generated-code-for-608683/).
- No RCT was found on agentic coding tools (as opposed to chat or autocomplete) and learning; the Anthropic authors flag this as likely worse but untested.
- No study was found on graduate-level ML coursework specifically.

---

## 2. Which usage patterns among AI users preserved learning and which destroyed it?

### Takeaway
Across three independent studies the same split appears: using AI to get explanations or to interrogate generated code preserves learning, while using it to produce or repair code without engaging does not. These pattern comparisons are descriptive (participants chose their own pattern) and rest on very small cells, so they are suggestive rather than causal.

### Cited Findings

**Anthropic interaction clusters [OBS within an RCT; 24 of 25 coded AI participants]**
- Low-scoring patterns (quiz average below 40%): AI Delegation (n=4; fastest, few or no errors), Progressive AI Reliance (n=4; asked one or two questions then delegated everything, poor mastery of the second task's concepts), Iterative AI Debugging (n=4; many queries, slower, poor scores) (primary) — [arXiv HTML](https://arxiv.org/html/2601.20245v1)
- High-scoring patterns (quiz average 65% or higher): Generation-Then-Comprehension (n=2; generated code then asked follow-ups to understand it), Hybrid Code-Explanation (n=3; asked for code with explanations), Conceptual Inquiry (n=7; only conceptual questions, hit many errors and resolved them independently, second-fastest group after Delegation) (primary) — [arXiv HTML](https://arxiv.org/html/2601.20245v1)
- Score ranges stated in the discussion: 65%-86% for high-scoring patterns, 24%-39% for low-scoring (primary). Per-cluster figures from a figure summary: generation-then-comprehension 86% (24 min), hybrid code-explanation 68% (24 min), conceptual inquiry 65% (22 min), delegation about 39% (secondary) — [arXiv HTML](https://arxiv.org/html/2601.20245v1); [Anthropic research page](https://www.anthropic.com/research/AI-assistance-coding-skills)
- Query mix: 79 explanation queries (21 of 25 participants asked at least one), 51 generation queries (16 of 25), 9 debugging queries. Some participants spent up to 11 minutes composing queries, over 30% of task time (primary) — [arXiv HTML](https://arxiv.org/html/2601.20245v1)
- Typing versus pasting AI code made no notable difference to quiz score; pasting was simply faster. Retyping generated code is not a learning mechanism in this data (primary) — [arXiv HTML](https://arxiv.org/html/2601.20245v1)
- Control participants spent more time actively coding and had higher scores (primary) — [arXiv HTML](https://arxiv.org/html/2601.20245v1)

**Lehmann et al.: substitute versus complement [exploratory within RCTs; one manipulated lever]**
- Asking for solutions (substitution) increased the number of topics covered but reduced understanding of each (solution requests: -0.31 on understanding, p < 0.01). Asking for explanations (complementation) did not change topic volume but raised understanding (p = 0.05) (primary) — [arXiv HTML](https://arxiv.org/html/2409.09047v2)
- A quasi-manipulated friction lever: with copy-paste blocked (Study 2) participants sent 4.45 messages on average and 42.2% were solution requests; with copy-paste enabled (Study 3) 7.71 messages and 64.2% solution requests (p = 0.002 for message count). Enabling copy-paste raised solution requests but not explanation requests, and its effect on understanding was -1.41 (p < 0.01) (primary) — [arXiv HTML](https://arxiv.org/html/2409.09047v2)

**Contractor & Reyes: augmentation versus automation [descriptive within an RCT]**
- ChatGPT logs were hand-coded: roughly 61% of students used AI as a tutor ("augmentation"), 9% had it do the work ("automation"), 27% mixed. At one week, augmentation users retained a test gain (0.24 SD, p = 0.095) while automation users did not (-0.24 SD, n.s.). Automation users' essay advantage of 1.50 SD in session one collapsed to -0.14 SD unaided a week later, a 1.64 SD drop (p = 0.023). The authors label these comparisons descriptive (primary) — [arXiv HTML](https://arxiv.org/html/2607.08849v2)
- Mechanism measured: total time was unchanged, but AI users shifted about 5 percentage points of time from writing to reading and searching (primary) — [arXiv HTML](https://arxiv.org/html/2607.08849v2)

**Tool-level patterns**
- Bastani: a hint-giving tutor removed the 17% exam penalty seen with the answer-giving interface — [Wharton summary](https://knowledge.wharton.upenn.edu/article/without-guardrails-generative-ai-can-harm-education/)
- CodeAid deployment: when direct code was withheld, students mainly used the tool for conceptual questions and debugging help, but some attempted to extract code and some defected to ChatGPT — [arXiv 2401.11314](https://arxiv.org/abs/2401.11314)
- Prather et al.: students without metacognitive difficulties used Copilot to accelerate and ignored unhelpful suggestions; struggling students accepted more suggestions (34.1% versus 24.5% acceptance) and were led down wrong paths (primary) — [arXiv HTML](https://arxiv.org/html/2405.17739v1)
- A small controlled study (24 undergraduates) reports that both over-reliance on and under-use of GenAI were associated with weaker knowledge gains (secondary) — [arXiv 2511.13271](https://arxiv.org/html/2511.13271)

### Inferences
- The dividing line is not "AI versus no AI" and not "typed versus pasted" but who does the generative and diagnostic thinking. Patterns where the learner still produced the code and resolved their own errors (Conceptual Inquiry) kept the learning; patterns where the AI resolved errors (Iterative AI Debugging) lost it even though the learner stayed busy.
- Iterative AI Debugging is the pattern an in-editor assistant most naturally invites ("fix this error"), and it was both slow and low-learning. Error resolution is the specific step the evidence says to leave with the student.
- Conceptual Inquiry was the most common high-scoring pattern and nearly as fast as delegation. A concept-only mode does not obviously cost much time, at least for experienced programmers on a one-hour task.
- Friction changes behavior: blocking copy-paste cut solution requests by about a third in Lehmann et al. But friction alone is not a learning mechanism (retyping did not help in the Anthropic data); it works only insofar as it redirects the learner toward explanation-seeking.
- Learners self-select patterns, so the high-scoring clusters may simply contain more capable or motivated people. Design conclusions drawn from the clusters are hypotheses.

### Gaps
- No study randomly assigned learners to interaction patterns (for example, concept-only versus generate-then-explain) in programming. The causal effect of enforcing a pattern is unknown; Bastani's Base-versus-Tutor arm is the nearest thing, in high-school math.
- Anthropic cluster sizes are 2 to 7 people; per-cluster means carry no meaningful precision.
- No evidence was found on whether generation-then-comprehension still works when the generated artifact is large (a whole module rather than a short function).

---

## 3. What do foundational learning-science concepts predict, and how strong is their evidence?

### Takeaway
The older literature predicts the AI findings well: learning depends on the learner generating, retrieving and struggling, and help that removes that effort lifts performance while cutting retention. Effect sizes in this literature are moderate (roughly g = 0.4-0.5 for generation, retrieval and problem-solving-first), mostly from lab or classroom studies not involving AI, and several come with boundary conditions that matter for an advanced learner.

### Cited Findings

**Productive failure / problem solving before instruction (Kapur) [META]**
- Sinha & Kapur (2021, Review of Educational Research 91(5)): 53 studies, 166 comparisons; problem solving followed by instruction beat instruction-first with Hedges' g = 0.36 (95% CI 0.20-0.51); designs faithful to productive-failure principles gave g = 0.37-0.58; a publication-bias-adjusted estimate was g = 0.87. The advantage reversed for second-to-fifth graders and for domain-general skills (secondary, consistent across listings) — [paper listing](https://ouci.dntb.gov.ua/works/4KnMgZq7); [ETH summary via phys.org](https://phys.org/news/2021-09-productively-wiser.html)
- A companion meta-analysis from the same group found no significant difference between unscaffolded problem-solving-first and scaffolded problem solving (g = -0.08), and a non-significant g = 0.22 against other sense-making activities, so the benefit is not specific to unguided failure — [ETH research collection](https://research-collection.ethz.ch/handle/20.500.11850/492056)
- Consistent AI-era observation: Anthropic control participants made three times as many errors (median 3 versus 1) and learned more, and the authors attribute the learning to resolving those errors — [arXiv HTML](https://arxiv.org/html/2601.20245v1)

**Generation effect [META]**
- Bertsch et al. (2007) meta-analysis: 86 studies, 445 effect sizes on generating versus reading information — [PubMed](https://pubmed.ncbi.nlm.nih.gov/17645161/)
- McCurdy et al. (2020): 126 articles, 310 experiments, 1,653 estimates, testing competing theoretical accounts — [Psychonomic Bulletin & Review](https://link.springer.com/10.3758/s13423-020-01762-3)
- A 2023 meta-analysis of generation with text materials found the benefit is strongest when the generation task triggers processing complementary to what the material already triggers; generation is not uniformly beneficial — [Educational Psychology Review](https://link.springer.com/article/10.1007/s10648-023-09758-w)

**Retrieval practice / testing effect [META]**
- Rowland (2014): testing versus restudy, overall g = 0.50; recall tests gave larger benefits than recognition tests (g value secondary; moderator from abstract) — [PubMed](https://pubmed.ncbi.nlm.nih.gov/25150680/)

**Worked examples and the expertise-reversal effect [META]**
- Tetzlaff, Simonsmeier, Peters & Brod (2025, Learning and Instruction 98, 102142): meta-analysis of the expertise-reversal effect covering 60 studies, 176 effect sizes and nearly 6,000 participants; the effect was strongest in higher education and weaker in languages and humanities (secondary, blog summary) — [Learning and the Brain summary](https://www.learningandthebrain.com/blog/one-size-doesnt-fit-all-teaching-experts-and-novices/)
- Definition: instructional techniques that help inexperienced learners lose effectiveness, and can have negative consequences, for more experienced learners — [Kalyuga review, Educational Psychology Review](https://link.springer.com/doi/10.1007/s10648-012-9195-x); [overview](https://en.wikipedia.org/wiki/Expertise_reversal_effect)

**Assistance dilemma, help abuse and hint gaming in intelligent tutoring systems [OBS, with some experiments]**
- The assistance dilemma is the trade-off between giving and withholding information to achieve optimal learning; Aleven et al. distinguish help avoidance from help abuse — [LearnLab wiki](https://learnlab.org/research/wiki/index.php/Help_abuse)
- Prevalence: in a Geometry Cognitive Tutor study, hint abuse made up 36% of student actions (14% when rapid successive hint requests are counted as one action) — [LearnLab wiki](https://learnlab.org/research/wiki/index.php/Help_abuse)
- Baker, Corbett & Koedinger (2004): gaming the system is correlated with substantially lower learning. This is correlational — [paper PDF](https://www.cs.cmu.edu/~rsbaker/BCK2004MLFinal.pdf)
- Counter-evidence: Shih, Koedinger & Scheines (2008) show bottom-out hints can function as worked examples; time spent after receiving the answer (a proxy for self-explanation) predicts learning — [paper PDF](https://www.cmu.edu/dietrich/philosophy/docs/scheines/Shih_Koedinger_Scheines_2008_EDM.pdf)
- A study of 50 algebra students found no evidence that hint type (high-level versus bottom-out) influenced learning — [Cognitive Science Society proceedings](https://journalpub.escholarship.org/cognitivesciencesociety/article/28865/galley/18736/download)
- Roll, Aleven, McLaren & Koedinger worked on tutoring help-seeking itself as a metacognitive skill inside an ITS — [paper PDF](https://www.cs.cmu.edu/~bmclaren/pubs/RollEtAl-ImprovingMetacogSkillsWithITS-LandI2010.pdf)
- Modern echo: CS50's rate-limited "hearts" are a help-throttling mechanism in the same tradition, justified by the authors as encouraging more deliberate questions, though its effect on learning was not measured — [paper PDF](https://cs.harvard.edu/malan/publications/V1fp0567-liu.pdf)

**Cognitive load [mixed]**
- Lower load is not the same as more learning: in the TUM trial AI users reported lower cognitive load and frustration with no gain in conceptual learning — [TUM EdTech summary](https://www.edtech.tum.de/?p=3520)
- Kestin's tutor explicitly managed cognitive load and sequencing and did produce gains, so reducing extraneous load while keeping the learner active is compatible with learning — [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/)

### Inferences
- The Shih et al. finding and the Anthropic "generation-then-comprehension" cluster say the same thing 18 years apart: receiving an answer is not what harms learning; failing to process it is. Time spent studying a revealed answer is a measurable proxy for that processing.
- Expertise reversal cuts both ways for an advanced learner. Heavy scaffolding, forced Socratic dialogue and step-by-step hints built for CS1 novices are predicted to be redundant or counterproductive for a graduate-level student; but the Anthropic and Lehmann data show that experienced programmers are still novices with respect to the new material, and delegation still cost them learning there.
- Productive failure has a boundary: scaffolded problem solving performed as well as unscaffolded struggle in the companion meta-analysis. The evidence supports "attempt first, then get help", not "struggle with no help".
- ITS research implies some share of learners will game any hint system if a bottom-out answer is reachable; rate limits and requiring an attempt before help are the long-standing countermeasures, with correlational rather than causal support.

### Gaps
- Desirable difficulties (Bjork) and spacing: no primary source or meta-analytic effect size was retrieved this session; they are relevant theory but uncited here.
- Self-explanation (Chi): no primary source or effect size was retrieved this session.
- The overall effect size in Bertsch et al. (2007) (commonly quoted as about 0.40) was not confirmed against the paper.
- The pooled effect size from Tetzlaff et al. (2025) was not retrieved; a second 2025 Tetzlaff citation appeared in search results and the exact reference should be checked before citing.
- Koedinger & Aleven's original assistance-dilemma paper (2007) was not read directly; the description comes from the LearnLab wiki.
- None of these foundational effects has been tested head-to-head against LLM assistance in programming at graduate level; applying them is theory-based prediction.

---

## 4. Over-reliance, metacognition and miscalibration; novices versus advanced learners

### Takeaway
Learners with AI consistently overestimate what they learned, and the evidence for this includes one experimental estimate (Lehmann) alongside several qualitative studies. Prior knowledge moderates the outcome, with stronger learners generally benefiting more or being harmed less, but the one study on experienced developers learning something new (Anthropic) found harm at every experience level, so expertise in programming generally does not protect learning of unfamiliar material.

### Cited Findings

**Miscalibration**
- Lehmann et al. [RCT]: LLM access raised perceived learning by 0.34 on a five-point scale (p = 0.044) after controlling for actual pre-to-post gains (primary) — [arXiv HTML](https://arxiv.org/html/2409.09047v2)
- Prather et al., "The Widening Gap" (ICER 2024) [OBS, n=21, CS1, C++, think-aloud plus eye tracking]: 20 of 21 produced a working program, yet 10 exhibited metacognitive difficulties and "finished with an illusion of competence". Three new difficulties: Interruption (suggestions break concentration), Mislead (tool leads the user down the wrong path), Progression (being conceptually behind without realizing it, due to false confidence). Interview statements often contradicted observed behavior. The new difficulties correlated negatively with course grade (r = -.503, p = .020). Learning was not measured directly (primary) — [arXiv HTML](https://arxiv.org/html/2405.17739v1)
- Zi et al. (FSE Companion 2025) [OBS, n=32 CS1 students, 160 task instances]: students correctly predicted the output of LLM-generated code in only 32.5% of tasks; 90.6% at least once assumed the code did what the prompt asked even when it did not (automation bias); half noticed code seemed wrong but could not work out what it did (primary) — [arXiv HTML](https://arxiv.org/html/2504.19037v1)
- Anthropic [RCT]: the AI group rated the task easier but the quiz equally hard, and rated their own learning lower than control did, so in this sample of experienced developers self-assessment moved in the right direction (primary) — [arXiv HTML](https://arxiv.org/html/2601.20245v1)
- Contractor & Reyes [RCT]: no significant effect of AI access on self-assessed knowledge (primary) — [arXiv HTML](https://arxiv.org/html/2607.08849v2)
- CS50: despite being told to think critically, 23% of students were "very confident" and 46% "generally confident" in the Duck's accuracy; the authors note that the model sounds authoritative even when wrong (primary) — [paper PDF](https://cs.harvard.edu/malan/publications/V1fp0567-liu.pdf)
- Lee et al. [OBS, survey]: higher confidence in the AI was associated with less critical thinking; higher self-confidence in the task with more — [Microsoft Research](https://www.microsoft.com/en-us/research/?p=1135061)

**Prior knowledge and expertise**
- Lehmann et al.: treatment interacted positively with above-median pre-test score for overall outcomes (p = 0.028) and understanding (p = 0.034); low-prior-knowledge treated students understood less than controls (p = 0.043). The authors conclude LLMs widen gaps in education (primary) — [arXiv HTML](https://arxiv.org/html/2409.09047v2)
- Kazemitabaar et al. CHI 2023: higher prior (Scratch) scores predicted better retention only among those who had Codex — [arXiv 2302.07427](https://arxiv.org/abs/2302.07427)
- Prather et al.: the 11 students without metacognitive difficulties used GenAI to accelerate and ignored bad suggestions; the authors propose the ability to ignore unhelpful suggestions as a key skill (primary) — [arXiv HTML](https://arxiv.org/html/2405.17739v1)
- Against a simple "experts are safe" reading: in the Anthropic study, where 29 of 52 had 7+ years of experience, the control group outscored the AI group at every experience level (primary) — [arXiv HTML](https://arxiv.org/html/2601.20245v1)
- The Lehmann field study, which found a long-run decline associated with substitutive ChatGPT use, was conducted in graduate-level Python courses (primary) — [arXiv HTML](https://arxiv.org/html/2409.09047v2)
- Maier et al. meta-analysis: educational level (university versus pre-university) did not significantly moderate the learning effect (p = 0.812), with few studies (primary) — [arXiv HTML](https://arxiv.org/html/2605.04779v1)

**Compliance and self-control**
- In the Anthropic pilots, 25-35% of participants assigned to the no-AI condition used AI anyway, even after warnings (primary) — [arXiv HTML](https://arxiv.org/html/2601.20245v1)
- Lehmann et al. note that self-control and present bias are plausible explanations for substitutive use but did not test them (primary) — [arXiv HTML](https://arxiv.org/html/2409.09047v2)

### Inferences
- A learner's own sense of "I understand this" is unreliable when AI was involved and the code works. Passing tests or a running program is the specific cue that misleads (Prather: 20 of 21 working programs, half with difficulties). An editor should supply an external check, such as unassisted prediction or explanation of code behavior, rather than rely on the learner's judgment.
- For the user (advanced, graduate-level ML), the relevant category is "experienced programmer, new material", which is the Anthropic population. Expect better self-regulation and better ability to reject bad suggestions than CS1 students show, and expect less of the illusion of competence, but still expect a real learning cost from delegating implementation or debugging of the unfamiliar parts.
- The benefit that higher-prior-knowledge learners get appears to come through usage pattern (they ask for explanations and filter suggestions) rather than immunity. That makes pattern-shaping features relevant even for strong learners.
- Voluntary restraint is weak: a quarter to a third of paid participants broke a no-AI rule. A tool that depends on the learner choosing not to ask for the answer should expect regular defection, and the learner defecting to an external chatbot (as CodeAid educators observed) is the practical failure mode of strict guardrails.

### Gaps
- No study was found that measures metacognitive calibration with AI among graduate students or expert programmers learning ML specifically.
- Evidence on novices versus experts is mostly within-novice variation (higher versus lower pre-test in intro courses). A direct comparison of true novices and advanced learners under the same AI condition was not found.
- Prather et al. and Zi et al. are single-site and small; Prather et al. did not measure learning outcomes.
- The phrase "illusion of competence" is used by Prather et al.; I did not verify related claims from Prather's other papers (for example the 2023 Copilot usability study) this session.

---

## 5. Where is the evidence weak, contested or contradictory?

### Takeaway
The headline finding (assisted performance up, unassisted learning flat or down) is reasonably well replicated, but almost every individual study is small, short, single-site or measured immediately, and the positive and negative results are not yet reconciled by any study that randomizes the usage pattern itself. Nothing reviewed tracks skill over a semester or longer under randomized conditions in programming.

### Cited Findings

**Contradictory overall effects**
- Negative: Anthropic d = 0.74 lower quiz score; Bastani 17% lower exam score with unguarded GPT — [arXiv HTML](https://arxiv.org/html/2601.20245v1); [Wharton summary](https://knowledge.wharton.upenn.edu/article/without-guardrails-generative-ai-can-harm-education/)
- Null: Lehmann lab studies; Kazemitabaar 2023 retention; TUM conceptual learning; pooled programming meta-analysis g = 0.14 with CI spanning zero — [arXiv HTML](https://arxiv.org/html/2409.09047v2); [arXiv 2302.07427](https://arxiv.org/abs/2302.07427); [TUM EdTech summary](https://www.edtech.tum.de/?p=3520); [Maier et al.](https://arxiv.org/html/2605.04779v1)
- Positive: Kestin 0.63 SD with a purpose-built tutor; Contractor & Reyes +0.28 SD with off-the-shelf ChatGPT on a reading-and-essay task — [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/); [arXiv HTML](https://arxiv.org/html/2607.08849v2)
- Heterogeneity in the programming meta-analysis is very high (I² = 86%), and nearly half of it is explained by whether AI was allowed during the assessment — [Maier et al.](https://arxiv.org/html/2605.04779v1)

**Small samples and thin cells**
- Anthropic: 26 per arm; interaction clusters of 2-7 people — [arXiv HTML](https://arxiv.org/html/2601.20245v1)
- MIT EEG: 18 per group, 18 total in the crossover session — [The Decoder](https://the-decoder.com/mit-study-shows-cognitive-debt-through-chatgpt-heres-what-it-means-in-real-world-practice/)
- Prather: 21 students at one site; Zi et al.: 32 at one site — [arXiv HTML](https://arxiv.org/html/2405.17739v1); [arXiv HTML](https://arxiv.org/html/2504.19037v1)
- The programming learning meta-analysis has only 10 studies and 11 effect sizes, with 59.3% of effect sizes across the corpus at higher risk of bias, and pools randomized with non-randomized designs — [Maier et al.](https://arxiv.org/html/2605.04779v1)

**Short horizons and immediate outcomes**
- Anthropic: about one hour, quiz immediately afterwards — [arXiv HTML](https://arxiv.org/html/2601.20245v1); [critique](https://smbadiwe.github.io/post/skill-tax-of-ai-coding)
- Kestin: two lessons, immediate post-tests, no retention measure, tests not graded — [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/)
- Lehmann lab studies: 45-minute learning phase — [arXiv HTML](https://arxiv.org/html/2409.09047v2)
- Longest delayed measures found: one week (Kazemitabaar 2023; Contractor & Reyes) — [arXiv 2302.07427](https://arxiv.org/abs/2302.07427); [arXiv HTML](https://arxiv.org/html/2607.08849v2)
- The only longer-run programming evidence (Lehmann field study, over a course) relies on a code-similarity proxy for ChatGPT use and an outage instrument — [arXiv HTML](https://arxiv.org/html/2409.09047v2)

**Measurement validity**
- The Anthropic quiz had no code-writing items; skill was measured by debugging, reading and conceptual questions only — [arXiv HTML](https://arxiv.org/html/2601.20245v1)
- Lee et al. measure self-reported critical thinking, not performance — [author-hosted PDF](https://advait.org/files/lee_2025_ai_critical_thinking_survey.pdf)
- MIT EEG connectivity differences are not a learning measure, and the analysis choices are disputed — [arXiv 2601.00856](https://arxiv.org/abs/2601.00856v1)
- CS50 results are satisfaction and usage, with a 73% end-of-term response rate and non-anonymous surveys — [paper PDF](https://cs.harvard.edu/malan/publications/V1fp0567-liu.pdf)
- Usage-pattern results in Anthropic, Lehmann and Contractor & Reyes are all self-selected and labelled exploratory or descriptive by their authors — [arXiv HTML](https://arxiv.org/html/2601.20245v1); [arXiv HTML](https://arxiv.org/html/2409.09047v2); [arXiv HTML](https://arxiv.org/html/2607.08849v2)

**Peer-review status and funding**
- Not peer reviewed as of the versions read: Anthropic (arXiv), Lehmann (arXiv), Contractor & Reyes (arXiv), Maier meta-analysis (arXiv), MIT EEG (arXiv; reported as submitted) — [arXiv 2601.20245](https://arxiv.org/html/2601.20245v1); [arXiv 2409.09047](https://arxiv.org/html/2409.09047v2); [arXiv 2607.08849](https://arxiv.org/html/2607.08849v2); [arXiv 2605.04779](https://arxiv.org/html/2605.04779v1); [Scientific American](https://www.scientificamerican.com/article/does-using-chatgpt-really-change-your-brain-activity/)
- Industry involvement: the Anthropic study was run by an Anthropic employee and an Anthropic Fellow with internal ethics review, though its finding runs against the vendor's commercial interest; Lee et al. is Microsoft Research; CS50 acknowledges support from OpenAI, Microsoft, GitHub and Ed — [arXiv HTML](https://arxiv.org/html/2601.20245v1); [Microsoft Research](https://www.microsoft.com/en-us/research/?p=1135061); [paper PDF](https://cs.harvard.edu/malan/publications/V1fp0567-liu.pdf)
- Kestin et al. note that they are also authors in the active-learning literature they compare against, and the tutor depended on expert-written solutions — [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/)

**Model and interface drift**
- Studies used Codex (2022), gpt-3.5-turbo, GPT-4 and GPT-4o in chat or autocomplete form; the Anthropic authors flag that agentic tools may produce more offloading, untested. The Maier meta-analysis lists rapidly changing model capability as a limitation and found no upward time trend in productivity effects — [arXiv HTML](https://arxiv.org/html/2601.20245v1); [Maier et al.](https://arxiv.org/html/2605.04779v1)

**Guardrails are imperfect in practice**
- Harvard's own guardrailed Duck reportedly still returns code blocks up to a quarter of the time (secondary) — [Harvard Gazette](https://news.harvard.edu/gazette/story/2026/09/taming-the-duck-for-starters/)
- Kestin et al. found a system prompt alone did not reliably enforce step sequencing and had to enforce it in the platform — [PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC12179260/)

### Inferences
- The apparent contradictions mostly dissolve along three axes: whether the assessment was unassisted, whether the AI replaced the generative step that constitutes the skill, and whether the tool was engineered to withhold answers. No single study varies all three, so this reconciliation is an inference, not a tested result.
- Claims about long-term skill atrophy or "cognitive debt" are not established by the studies reviewed; the supporting evidence is a one-hour RCT, a one-week follow-up and a proxy-based field study.
- Prompt-level guardrails should be expected to leak; both Harvard teams ended up needing structural enforcement or accepted a leak rate.
- The evidence base is weakest exactly where the user sits: advanced learners, multi-week projects, modern agentic tooling and ML-systems content. Design decisions there rest on extrapolation from the Anthropic study plus theory.

### Gaps
- No preregistered, semester-long RCT of AI assistance in a programming course with delayed unassisted assessment was found.
- No direct replication of the Anthropic study by an independent group was found as of this search.
- No peer-reviewed version of the MIT EEG study was located; I did not find a formal author response to the published commentary.
- I did not locate a 2026 meta-analysis restricted to randomized trials of LLM tutors.
- Several figures are flagged above as secondary (Bastani N and SD-unit effects, Anthropic group means and per-cluster scores, TUM numerics, Rowland g, Tetzlaff details, the CS50 "quarter of the time" leak rate) and should be checked against the primary papers before being quoted in a final report.
