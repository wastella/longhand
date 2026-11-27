# Architecture

Longhand is a [Tauri 2](https://tauri.app) app: a Rust process that owns everything with side
effects, and a web interface in the system webview that owns everything on screen.

```
┌──────────────────────── interface (src/renderer) ────────────────────────┐
│  file tree · CodeMirror editor · xterm.js terminal · tests · tutor chat  │
└───────────────┬──────────────────────────────────────────▲───────────────┘
        commands (invoke)                           events (emit)
┌───────────────▼──────────────────────────────────────────┴───────────────┐
│                         backend (src-tauri/src)                          │
│  main.rs    files, settings, usage log, menu                             │
│  term.rs    login shell on a pseudo-terminal                             │
│  pytest.rs  `uv run pytest` → parsed results                             │
│  tutor.rs   `claude -p` with read-only tools → streamed answer           │
└──────────────────────────────────────────────────────────────────────────┘
```

## Rules the backend keeps

- **One folder.** Every path from the interface goes through `in_workspace`, which rejects
  anything outside the open folder, including through `..` and symlinks.
- **The tutor is read-only.** `tutor.rs` passes `--tools Read,Glob,Grep --restricted
--strict-mcp-config --permission-mode dontAsk`. When the CLI reports its tool list at start-up,
  anything outside those three aborts the run.
- **The user's login, never a key.** `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are removed
  from the tutor's environment so a stray key cannot be billed by accident.
- **The window shows only the app.** Navigation away from the bundled page is refused, the content
  security policy allows no remote or inline script, and tutor answers are sanitized before they
  are rendered. Links open in the browser.

## The tutor conversation

The first question in a conversation starts `claude` with a new session id and a system prompt
built from `tutor-prompt.md`, the folder's policy, and its `AGENTS.md` or `CLAUDE.md` if present.
Later questions resume that session. Changing the policy starts a new conversation, because the
system prompt is fixed for the life of a session.

The interface adds context to each question inside `<context>` tags: the open file, the cursor
line, any selection, and an attached test failure.

Answers stream back as events. The interface renders them as Markdown and hides fenced code blocks
longer than the policy allows (2 lines on Strict, 12 on Guided; shell and plain-text blocks are
exempt) behind a button that records the reveal.

## Per-folder data

`.longhand/config.json` holds the policy and model. `.longhand/log.jsonl` is an append-only record
of questions, test runs, reveals and setting changes. Neither leaves the machine.

## Testing

- `cargo test` covers path safety, settings, the log and pytest parsing.
- `npm run test:ui` runs the built interface in headless Chrome against
  `scripts/mock-backend.js`, which implements the same commands and events as the Rust backend.
- `npm run smoke` drives the real app, with a real terminal, pytest and tutor.
