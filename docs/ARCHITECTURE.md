# Architecture

Longhand is a [Tauri 2](https://tauri.app) app: a Rust process that owns everything with side
effects, and a web interface in the system webview that owns everything on screen.

```
┌───────────────────────────── interface (src/renderer) ─────────────────────────────┐
│  shell/  layout, panels, title and status bars, welcome, text size, commands       │
│  editor/ · files/ · terminal/ · tests/ · tutor/      one directory per area        │
│  state.js  shared state + event bus          backend.js  the only door to Rust     │
└───────────────────┬────────────────────────────────────────────▲───────────────────┘
            commands (invoke)                               events (emit)
┌───────────────────▼────────────────────────────────────────────┴───────────────────┐
│                              backend (src-tauri/src)                               │
│  main.rs       start-up and command registration                                   │
│  workspace.rs  the open folder, per-folder config, usage log, app state            │
│  files.rs      file commands, in_workspace, quick open, find in files, watching    │
│  menu.rs       the native menu; item ids become `menu` events                      │
│  system.rs     confirm dialog, opening links, self-test result                     │
│  term.rs       login shell on a pseudo-terminal                                    │
│  pytest.rs     `uv run pytest` → parsed results                                    │
│  tutor.rs      `claude -p` with read-only tools → streamed answer                  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## The interface

`index.html` holds only the root regions: `#titlebar`, `#files`, `#editor`, `#welcome`,
`#bottom`, `#tutor` and `#status`. `main.js` mounts each area into its region, then asks the
backend for start-up state. Each area builds its own markup in its `mount()`.

| Area        | Owns                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `shell/`    | Layout and splitters, panel toggles, bottom panel tabs, title bar (usage, auth), status bar, welcome, text size, the command registry |
| `editor/`   | CodeMirror setup and languages, tabs, saving, reloading files changed on disk, the unsaved-changes quit prompt                        |
| `files/`    | File tree, its context menu and naming field, quick open, find in files, watching the folder                                          |
| `terminal/` | xterm.js and the shell session                                                                                                        |
| `tests/`    | Running pytest and showing results                                                                                                    |
| `tutor/`    | Conversation, Markdown rendering and the hidden-code check, context building, setup steps, quick actions                              |

How areas talk to each other:

- **Events** (`on`, `once`, `emit` in `state.js`) say what happened: `workspace:opened`,
  `editor:active`, `editor:cursor`, `tests:finished`, `tutor:finished`, `usage:changed`,
  `auth:changed`, `panel:toggled`, `text-size:changed`. The list with payloads is at the top of
  `state.js`.
- **Commands** (`registerCommand`, `runCommand` from `shell/`) are named actions. Menu items in
  `menu.rs` send their id as a `menu` event and `main.js` runs the command with that id, so an
  area adds a menu action by registering a command and adding the item in `menu.rs`.
- **Public functions.** Each area's `index.js` is its public surface. Other areas import only
  from there (for example `openFile` and `activeFile` from `editor/index.js`), never from an
  area's inner files.

Only `backend.js` touches `window.__TAURI__`, which is what lets the same interface run against
the mock backend in `tests/mock/`.

Styles: `styles/tokens.css` defines every colour, size and radius; `base.css` the shared
components; then one file per area. `build.mjs` joins them into `dist/styles.css`. See
[DESIGN.md](DESIGN.md).

## Rules the backend keeps

- **One folder.** Every path from the interface goes through `in_workspace` in `files.rs`, which
  rejects anything outside the open folder, including through `..` and symlinks.
- **The tutor is read-only.** `tutor.rs` passes `--tools Read,Glob,Grep --restricted
--strict-mcp-config --permission-mode dontAsk`. When the CLI reports its tool list at start-up,
  anything outside those three aborts the run.
- **The user's login, never a key.** `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are removed
  from the tutor's environment so a stray key cannot be billed by accident.
- **The window shows only the app.** Navigation away from the bundled page is refused, the content
  security policy allows no remote or inline script, and tutor answers are sanitized before they
  are rendered (`tutor/markdown.js`). Links open in the browser.

## The tutor conversation

The first question in a conversation starts `claude` with a new session id and a system prompt
built from `tutor-prompt.md`, the folder's policy, and its `AGENTS.md` or `CLAUDE.md` if present.
Later questions resume that session. Changing the policy starts a new conversation, because the
system prompt is fixed for the life of a session.

The interface adds context to each question inside `<context>` tags (`tutor/context.js`): the
open file, the cursor line, any selection, and an attached test failure.

Answers stream back as events. The interface renders them as Markdown and hides fenced code blocks
longer than the policy allows (2 lines on Strict, 12 on Guided; shell and plain-text blocks are
exempt) behind a button that records the reveal (`tutor/hidden-code.js`).

## Finding and watching files

`files/walk.rs` decides what the app sees. `.git`, `.longhand` and `.DS_Store` are never shown.
Environments, caches and build output (`.venv`, `__pycache__`, `node_modules`, …) and anything
the folder's `.gitignore` excludes (applied even before `git init`) are shown quietly in the
tree and left out of quick open and find in files. Other dotfiles, such as `.gitignore`, are
shown normally.

Quick open and find in files share one cached list of the folder's files (`files/index.rs`,
capped at 100,000). `fs_watch` watches the folder with `notify`; changes are gathered into
batches (200 ms of quiet, at most one per second, `[""]` past 500 paths) and sent as the
`files:changed` event. A batch marks the list stale rather than walking again, so a training
script writing checkpoints costs one walk at the next quick open. Searches run on a blocking
thread, skip files over 1 MB and binary files, stop at 500 hits, and each new search cancels the
one before it. The interface refreshes only the tree folders a batch touched and passes the
batch on to other areas as `files:changed`, leaving out the editor's own saves.

Which folders were expanded and which files were opened recently are kept per folder in
`tree-memory.json` in the app's data directory, not in the student's folder.

## Per-folder data

`.longhand/config.json` holds the policy and model. `.longhand/log.jsonl` is an append-only record
of questions, test runs, reveals and setting changes. Neither leaves the machine. Both are handled
in `workspace.rs`.

## Testing

- `cargo test` covers path safety, settings, the log and pytest parsing; each test sits next to
  the code it covers.
- `npm run test:ui` runs `tests/ui/<area>.test.mjs` with `node --test`, against the built
  interface in headless Chrome. `tests/mock/` implements the same commands and events as the
  Rust backend, one file per area, over a shared fixture folder (`fixture.js`).
- `npm run preview -- --out shot.png --scenario <name>` renders a scenario from
  `scripts/scenarios/` against the same mock, for looking at visual changes.
- `npm run smoke` drives the real app, with a real terminal, pytest and tutor (`smoke.js`).
