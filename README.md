# Longhand

[![CI](https://github.com/wastella/longhand/actions/workflows/ci.yml/badge.svg)](https://github.com/wastella/longhand/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

tl;dr: Longhand is an AI-native IDE built for students.

IDEs catering to professional devs harm students by providing AI-integration optimizing for productivity, not learning.
Longhand is for when the process of thinking through (and writing) code matters more than the end result. Longhand keeps the parts of AI
help that support learning (explaining concepts, looking up APIs, explaining errors, reviewing what you wrote) and leaves out
the parts that replace it.

## What it does

**The tutor can read your work, and nothing else.** It runs through your own Claude Code login
with read-only tools, so it cannot edit a file or run a command. There is no AI autocomplete and
no agent mode.

Help shows up where the work is, in three shapes:

- **Notes in the margin.** _Review this file_ (⇧⌘R) pins a handful of observations to the lines
  they are about, like a TA's pen marks: a question to consider, a possible bug and how to see it,
  something done well. Reply to a note to ask why, resolve it, or dismiss it. Select code and
  choose _Explain_ to get the explanation as a note on that selection.
- **Help under a failing test.** It starts by asking what you expected to happen (you can skip
  that), then helps you find the problem without stating the fix. The conversation stays with the
  test across reruns. When the test passes, one optional question: in a sentence, what was wrong?
- **Lookups and conversation.** ⇧⌘K answers a quick question (what a function returns, what an
  error means) in a popover and gets out of the way. The side panel is for open-ended questions
  about concepts and math, with rendered formulas and a hint ladder for when you are stuck.

Around that, an editor built for coursework and not much else:

- **Editor.** Python-first editing, find and replace, go to line, and tabs that reopen with the
  folder. Failed saves and files changed on disk are never silently lost or overwritten.
- **Files.** Go to File (⌘P), find in files, and a keyboard-driven tree that updates as files
  change. Generated and git-ignored folders are dimmed, and multi-gigabyte data files do not slow
  it down.
- **Terminal.** Up to four, with Run File (⌘R) and clickable `path:line` locations in tracebacks.
- **Tests.** Run one pytest test, a file, everything, or just the failures, with live progress.
  Failures show the assertion first and link to the line.
- **Light and dark themes**, and a keyboard shortcut for nearly everything (Help > Keyboard
  Shortcuts).

And the guardrails:

- **Course rules respected.** If the folder has an `AGENTS.md` or `CLAUDE.md` with rules for AI
  assistants, as some courses now ship, the tutor follows it.
- **Two policies per folder.** _Strict_: no code in answers. _Guided_: short examples on toy or
  analogous problems. Code beyond the limit is hidden behind a **Reveal (logged)** button, counted
  across a whole answer so a solution cannot arrive in pieces.
- **Your own record.** Questions, hints, lookups, test runs and reveals are counted per day in a
  Record view and in the title bar. The log and your tutor conversations are kept in `.longhand/`
  inside the folder, which Longhand tells Git to ignore. They never leave your machine.

## Install

There is no packaged release yet. For now, [build from source](#build-from-source).

For the tutor, install [Claude Code](https://claude.com/claude-code) and log in once by running
`claude` in a terminal. Longhand shows these steps itself if the tutor is not connected. The
editor, terminal and tests work without it.

The test panel runs `uv run pytest` when the folder has a `pyproject.toml`, and
`python3 -m pytest` otherwise.

## How the tutor is constrained

Longhand does not talk to a model directly and never handles your Claude credentials. It runs the
`claude` command-line tool you installed, on your own subscription, with:

- only the `Read`, `Glob` and `Grep` tools, so there is no tool that writes or executes;
- your personal Claude Code settings, plugins and MCP servers switched off for that run;
- a tutor prompt ([`src-tauri/src/tutor-prompt.md`](src-tauri/src/tutor-prompt.md)) plus the
  folder's course rules, if any.

The read-only limit is enforced by the harness: if any other tool is offered, Longhand stops the
run. The no-code policy is weaker. It is a prompt plus a check in the interface that hides code
blocks over the policy's limit. A determined student can get around it, and an unrestricted
chatbot is always one window away. Treat the policies as a commitment you chose, not a lock.

## Privacy

- Files the tutor reads, and your questions, go to Anthropic through your own Claude account,
  under the terms of that account.
- Longhand has no server, no telemetry and no accounts of its own.
- Your tutor conversations, margin notes, usage log and per-folder settings stay in `.longhand/`
  inside the folder. Longhand tells Git to ignore that folder, so they are not committed by
  accident.

## Build from source

Requires [Node.js](https://nodejs.org) 22+, [Rust](https://rustup.rs) stable, and Xcode's
command-line tools.

```bash
git clone https://github.com/wastella/longhand
cd longhand
npm install
npm run dev      # run the app
npm run build    # release build in src-tauri/target/release/bundle/
npm test         # interface tests (headless Chrome) and backend tests
```

## Roadmap

Not built yet, roughly in order:

- Python language server: errors underlined, go to definition, hover documentation
- Signed and notarized releases with automatic updates
- A measured leak rate for the tutor's policies, from a published set of adversarial prompts
- An API-key option for people without a Claude subscription
- Tensor shapes on hover for jaxtyping-annotated code
- Linux and Windows builds
- A debugger, and running on a remote machine beyond `ssh` in the terminal

Deliberately out of scope: AI autocomplete, agents that edit your files, and "fix it" buttons.

## Contributing

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), which covers setup,
tests and what kinds of changes fit the project. Security issues go through
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
