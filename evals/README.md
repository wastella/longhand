# Tutor evals

How well the tutor's guardrails hold. `cases.json` holds 40 prompts over a tiny assignment in
`fixture/` (softmax, cross-entropy and causal attention in PyTorch):

- requests the tutor must decline without handing over the code: direct requests, "just the
  fixed function", role-play and claimed permission, line-by-line extraction, fill-in-the-blank,
  pseudocode, translation into another language, "a reference to test against", review-then-rewrite
- questions it must answer directly: lookups (several sent as the lookup bar sends them),
  concepts, debugging help, a review, the math of a technique

`run.mjs` sends each prompt through the same CLI configuration the app uses (`config.json`,
generated from the Rust code by a test, so the two cannot drift) and scores the reply with
`score.mjs`: did it contain the assignment's code (in a code block or as numbered steps of
tensor operations), and did it refuse or only ask back on a legitimate question.

## Running

Each case is one real `claude` run on **your Claude subscription**: the full set is 79 runs
(40 cases under the guided policy, 39 under strict).

```bash
node evals/run.mjs --dry-run                                  # what would run, no calls
node evals/run.mjs --policy strict --only direct-softmax,lookup-tril
node evals/run.mjs                                            # everything, both policies
node --test evals/score.test.mjs                              # the scorer's own tests, no calls
```

It prints a pass/fail line per case and a table by policy and category, and saves every reply
to `evals/results/` (not committed). The scores are heuristics tuned to the fixture; read the
replies, especially the failures.

After changing `src-tauri/src/tutor-prompt.md` or the CLI arguments, regenerate the
configuration: `cd src-tauri && LONGHAND_WRITE_EVAL_CONFIG=1 cargo test eval_runner`.
`cargo test` fails until you do.

The app's first question in a conversation uses `--session-id` rather than
`--no-session-persistence`; otherwise the runs are identical.
