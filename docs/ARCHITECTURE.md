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
│  term.rs       up to four login shells on pseudo-terminals                         │
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
the folder's own `.gitignore` and `.ignore` files exclude (applied even before `git init`) are
shown quietly in the tree and left out of quick open and find in files. Ignore files above the
open folder and the user's global excludes do not count, so a `.gitignore` in the home folder
cannot hide coursework. Other dotfiles, such as `.gitignore`, are shown normally.

Quick open and find in files share one cached list of the folder's files (`files/index.rs`,
capped at 100,000). `fs_watch` watches the folder with `notify`; changes are gathered into
batches (200 ms of quiet, at most one per second, `[""]` past 500 paths) and sent as the
`files:changed` event, `{ root, paths }`. Batches stop once their folder is no longer the open
one, and the interface drops any whose `root` is not the open folder. A batch marks the list stale rather than walking again, so a training
script writing checkpoints costs one walk at the next quick open. Searches run on a blocking
thread, skip files over 1 MB and binary files, stop at 500 hits, and each new search cancels the
one before it; a walk or search of a folder that is no longer open gives up. Every file command
that touches the disk runs off the main thread. The interface refreshes only the tree folders a batch touched and passes the
batch on to other areas as `files:changed`, leaving out the editor's own saves.

Which folders were expanded and which files were opened recently are kept per folder in
`tree-memory.json` in the app's data directory, not in the student's folder.

## The terminals

Each terminal is a login shell on its own pseudo-terminal, named by an id the interface makes up
before calling `term_start`, so no early output is lost. Output reaches the interface through
`term/output.rs`: a reader thread, a pump that decodes UTF-8 across reads and coalesces output
into batches (`term:data` with `{ id, data, bytes }`), and flow control: the interface calls
`term_ack` once xterm.js has drawn a batch, and the pump stops reading while more than 512 KB is
undrawn, so a program printing too fast is held back by its own writes rather than freezing the
window. Each shell is a session leader, so `term/process.rs` can stop everything a terminal
started (background jobs included) by session id, and can tell a busy terminal by comparing the
pseudo-terminal's foreground process group with the shell's (`term_busy`, used by the leave
guard and Run File). Locations printed in the output are checked with `term_resolve`, which only
accepts files inside the open folder.

## The editor

One CodeMirror view shows the active tab; each open file keeps its own `EditorState` (text,
undo history, cursor, open notes) and scroll position while another tab is on screen
(`editor/session.js`). Files are read and written by `documents.rs`:

- `doc_read(rel)` returns `{ kind: 'text', text, mtime, format }`, or `{ kind, size }` with
  `kind` one of `binary`, `tooLarge` (over 3 MB; only the first 8 KB is read to tell binary from
  text) or `notText` (not UTF-8), or `{ kind: 'missing' }`. The editor shows a notice in place of
  the code for anything but text.
- `doc_write(rel, text, format, expectedMtime)` writes beside the file and renames over it, so a
  failed write never truncates the original. `format` (`{ lineEnding: 'lf' | 'crlf', bom }`)
  comes from `doc_read`: the editor works in `\n` and the file is saved with its own line
  endings and byte-order mark; nothing else is changed. With `expectedMtime`, a file changed or
  deleted since then is not written and the result's `status` is `changed` or `deleted` (the
  editor then asks); otherwise `saved` with the new `mtime`. Errors are sentences a student can
  act on ("You don't have permission to save …").
- `doc_stat(paths)` returns `{ mtime }`, `{ missing: true }` or `{ error }` per path.

The editor compares open files with the disk when the window gains focus, when a tab is shown,
on `files:changed`, and every 2 seconds while the window is focused (changes made in Longhand's
own terminal move no focus). A clean file is reloaded with the smallest change, so the cursor,
scroll position and notes stay with their text. A file with unsaved edits is never replaced
without the student choosing: a banner above the code offers "Keep my version" or "Load the disk
version", and a deleted one offers "Save it again". Failed saves use the same banner. Tabs with
unsaved edits are guarded on close, quit and folder switch (the `registerLeaveGuard` in
`editor/index.js`); `workspace:opened` arrives only after that guard passed, and then the editor
reopens the tabs that were open in that folder last time (kept in local storage).

### Hooks for the tutor

Exported from `editor/index.js`. They contain no AI: the tutor decides what to say, the editor
decides how it sits in the code.

- `setNotes(source, path, notes, { onOrphaned })` pins notes to a file, replacing the notes that
  `source` (any name, such as `'review'`) had there. A note is `{ id, fromLine, toLine, body }`:
  1-based inclusive lines and a DOM node the caller owns and may keep updating (the editor
  re-measures when it grows). Each note shows a bar in the gutter and a faint tint on its lines;
  clicking the bar or Alt+] / Alt+[ (next and previous note) opens the body beneath the range,
  and Escape or "Hide" closes it. Ranges follow edits: lines typed above move the note, and a
  line rewritten inside the range keeps it. When the note's text is deleted, or its lines are
  past the end of the file when it opens, the note is removed and `onOrphaned(id, path)` is
  called. Notes for files that are not open appear when they open, follow renames, and are
  forgotten when another folder opens.
- `clearNotes(source, path?)` removes `source`'s notes from one file, or from all of them.
- `notesOn(source, path)` returns `[{ id, fromLine, toLine }]` where the notes are now.
- `showNote(source, path, id)` opens the file and that note, scrolled into view.
- `registerSelectionAction({ id, label, run })` adds a button to the small row offered beside a
  selection once it has settled (and the mouse is up). `run({ path, fromLine, toLine, text })`
  gets the selected lines; a selection ending at the start of a line does not include it. The
  row hides as soon as the student types or moves the cursor, never takes focus on its own, and
  appears only when at least one action is registered. Alt+Enter moves focus to it; Escape goes
  back to the code. Returns a function that removes the action.

The interface tests and previews reach these through `window.__editor`, which exists only
under the mock backend.

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
