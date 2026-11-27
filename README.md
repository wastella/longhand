# Longhand

A quiet code editor for students. You write every line; the AI is a read-only tutor that
answers like a TA in office hours.

- **Editor, file tree, terminal, pytest panel.** No AI autocomplete, no agent mode.
- **Tutor on your Claude subscription.** It runs through the Claude Code install on this Mac
  (`claude` must be installed and logged in). It is started with only the Read, Glob and Grep
  tools, so it cannot edit files or run commands.
- **Course rules respected.** If the folder has an `AGENTS.md` or `CLAUDE.md` (CS336 ships one),
  the tutor follows it and the folder defaults to the strict policy.
- **Policies.** *Strict*: no code in answers. *Guided*: short toy examples allowed. Code beyond
  the policy's limit is hidden behind a "Reveal (logged)" button.
- **Your own record.** Questions, test runs and reveals are appended to `.longhand/log.jsonl`
  in the folder; today's counts show in the title bar.

## Run

```bash
npm install
npm run dev          # development build
npm run build        # release app in src-tauri/target/release/bundle/macos/Longhand.app
```

`longhand path/to/folder` opens a folder directly.

## Self-test

```bash
LONGHAND_SMOKE_DIR=/path/to/a/small/pytest/project npm run smoke
```

Drives the real window: opens the folder, edits and saves a file, runs a terminal command,
runs pytest, and asks the tutor two questions (this uses your Claude subscription).

## Layout

- `src/renderer/` – interface (CodeMirror 6, xterm.js), bundled by `build.mjs` into `dist/`
- `src-tauri/src/` – Rust backend: `main.rs` (files, config, log, menu), `term.rs`,
  `pytest.rs`, `tutor.rs`, and `tutor-prompt.md`
