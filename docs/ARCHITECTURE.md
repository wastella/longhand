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

A file's version on disk is its stamp, `{ mtime, size }`: the size catches a change made in the
same second as a save on file systems that keep whole seconds. All three commands do their file
system work on a blocking thread, so a hung network mount stalls only that call.

- `doc_read(rel)` returns `{ kind: 'text', text, mtime, size, format }` with the text exactly
  as on disk, or `{ kind, mtime, size }` with `kind` one of `binary`, `tooLarge` (over 3 MB;
  only the first 8 KB is read to tell binary from text) or `notText` (not UTF-8), or
  `{ kind: 'missing' }`. The editor shows a notice in place of the code for anything but text.
  `format` is `{ lineEnding: 'lf' | 'crlf' | 'cr', bom }`, the ending most lines use.
- `doc_write(rel, text, format, expected)` writes beside the file under an unpredictable name
  (created new, never through an existing entry) and renames over it, so a failed write never
  truncates the original; temporary files a crash left behind are removed on the next save of
  that file. `text` already carries its line endings and the BOM is added from `format`. With
  `expected` (a stamp), a file changed or deleted since then is not written and the result's
  `status` is `changed` or `deleted` (the editor then asks); otherwise `saved` with the new
  `mtime` and `size`. Errors are sentences a student can act on ("You don't have permission to
  save …").
- `doc_stat(paths)` returns `{ mtime, size }`, `{ missing: true }` or `{ error }` per path.

The editor works in `\n`. `editor/line-endings.js` remembers each line break that differs from
the file's usual ending (a CRLF line in an LF file, a lone CR) and follows it through edits, so
saving a mixed file changes only the lines the student touched; new lines get the usual ending.

The editor compares open files with the disk when the window gains focus, when a tab is shown,
on `files:changed` from the folder watcher (for the files and folders in the batch, or every
open file for `[""]`), and every 5 seconds while the window is focused, as a fallback for when
the watcher could not start and for changes the files area leaves out just after a save. All of
these go through the same check, so the races below are handled the same way. A check that gets no answer for 10 seconds says so in the status
bar, and checks resume once the disk answers. A clean file is reloaded with the smallest change,
so the cursor, scroll position and notes stay with their text. A file with unsaved edits is
never replaced without the student choosing: a banner above the code offers "Keep my version" or
"Load the disk version", and a deleted one offers "Save it again" (closing it asks first). The
same holds for typing that lands while a reload is reading the file, and a check that overlaps
one of the student's own saves is ignored for that file. Failed saves use the same banner. Tabs with
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
  clicking the bar or Cmd+Alt+] / Cmd+Alt+[ (next and previous note) opens the body beneath the
  range, and Escape or "Hide" closes it. Ranges follow edits: lines typed above move the note,
  and a line rewritten inside the range keeps it. When the note's code is deleted (or replaced
  along with code around it), the note is detached: hidden and left out of `notesOn`, but not
  yet lost. Undo puts it back with its code, and pasting or dropping that code elsewhere moves
  the note there, so cutting and pasting a function keeps its note. A detached note is removed
  and `onOrphaned(id, path)` called when its tab closes (undo history goes with the tab). A note
  whose lines are past the end of the file when it opens is removed and reported at once. Notes
  for files that are not open appear when they open and follow renames; when another folder
  opens, every note is removed and `onOrphaned` called for each.
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

## The test panel

`pytest.rs` runs `uv run pytest` (when the folder has `pyproject.toml` or `uv.lock`) or
`python3 -m pytest` from the student's login shell, which hands the command to `/bin/sh` so it
reads the same whatever that shell is. Every argument is single-quoted (zsh would otherwise read
`test_a[1-2]` as a pattern). The run has a process group of its own so Stop ends everything it
started (SIGTERM, then SIGKILL after two seconds); quitting the app waits until the group is
gone. Before starting it checks that the folder holds Python at all. `--rootdir=.` keeps node
ids relative to the open folder even when a `pytest.ini` sits in a folder above it.

Results do not come from scraping pytest's terminal text. A small reporter plugin
(`pytest/plugin.py`, loaded with `-p longhand_pytest`; its folder joins `PYTHONPATH` inside the
command, after the shell profile, so a profile cannot drop it) writes one JSON record per test
phase to a file, which `pytest/report.rs` reads while the run goes and turns into results:
status, duration, the assertion with pytest's explanation, the traceback's frames (each marked as
the student's own code or a library), and captured output (capped in the plugin, start and end
kept). pytest's own output is relayed for the raw view a few times a second, in bounded batches.
Single tests are not passed to pytest as arguments: pytest gets their files, and the plugin keeps
just the tests asked for, so a renamed test is simply not found rather than failing the command.
The command shown in the Output view is the equivalent one a student could type.

Rules that keep a result from being wrong:

- One result per node id. A failure is never undone by a later report (a passing subtest, the
  test's own call after a failing subtest); a teardown error after a skip or pass is an error;
  pytest-rerunfailures' failed attempts do not count, only the last; failures pytest counts
  without reporting at the time (unittest's `subTest` in some versions) are applied late.
- A run that ends without pytest's orderly finish (a crash, `os._exit`, a signal, `pytest.exit`,
  Ctrl+C) gives the test that was running an error saying so, and the run a `stopped-early`
  problem. It is not `complete`, and is never shown as passing.
- After a run that was stopped or did not complete, earlier results for tests it did not reach
  are kept, marked out of date (`unreached`). An earlier result is dropped only when a complete
  run collected everything and did not collect that test (or, for an import error, when
  collection finished without it).
- With pytest-xdist the count comes from the workers; a run that never says how many tests
  there are shows progress without an end.

When a run goes wrong, `pytest/problem.rs` says why in plain words (uv or pytest missing,
nothing collected, conftest.py failing to import, pytest stopping early, …). It reads pytest's
output for this only before pytest started, so a test printing the same words is not taken for
the environment. The fixtures in `pytest/fixtures/` are recorded from real pytest runs, including
one with pytest-xdist and pytest-rerunfailures; other tests run real pytest when `python3` has it.

Every backend event carries the run's id (`run`, which the interface passes to `tests_run`), and
a run that is cancelled, replaced or left behind by a folder switch sends nothing more; the
interface ends a cancelled run itself. Events: `tests:output` (`{ run, text }`),
`tests:progress` (`{ run, updates }`, a list of
`{ type: 'started' | 'collected' | 'running' | 'result' | 'collect-error', … }`; a `result` for a
test that has one replaces it) and `tests:done` (`{ run, command, targets, code, signal,
cancelled, complete, problem, summary, total, collected, duration, tests, errors, output }`).
`tests_run({ targets, run })` takes node ids or paths (all tests when empty) and returns
`{ run, command }`, or `{ run, problem }` when it will not start. Targets starting with `-` or
`@` are refused.

In the interface, `runner.js` keeps the current run and the latest results, merged across runs
so running one file keeps the others' results; `model.js` reads node ids, merges and groups
results; `list.js` and `detail.js` draw the two sides. Saving a file (`editor:saved`) marks
results that ran before it as possibly out of date.

What `tests/index.js` offers other areas:

- `latestResults()` returns `{ running, tests, errors, problem, summary, cancelled, complete,
stale, unreached, counts }`. A test's `id` is its pytest node id
  (`tests/test_m.py::TestA::test_b[1]`), which stays the same from run to run. `stale` lists
  results from before a save, `unreached` results kept from an earlier run because the last one
  stopped before them.
- `tests:selected` is emitted with the result shown in the panel, or null; again when that
  test gets a new result; and with null when another folder is opened.
- `registerFailurePanel(render, dispose, update)` attaches something beneath a failing test's
  detail. `render(test)` returns a node (or null) and is called the first time that failing test
  is shown; the panel keeps that node for as long as the test keeps failing, across reruns, so a
  conversation pinned to a failure survives the next run. `update(test, node)` is called when it
  fails again differently (a new status, message or traceback). `dispose(test, node)` is called
  when the test no longer fails, when a complete run shows it no longer exists, or when another
  folder is opened; never for a test a stopped or crashed run did not reach. Whatever the three
  throw is caught and logged, so the panel cannot break the test pane or stop `tests:finished`.
  It returns a function that unregisters; calling it twice, or after another panel took over,
  does nothing. Only one panel can be registered at a time.

## Per-folder data

`.longhand/config.json` holds the policy and model. `.longhand/log.jsonl` is an append-only record
of questions, test runs, reveals and setting changes. Neither leaves the machine. Both are handled
in `workspace.rs`.

## Testing

- `cargo test` covers path safety, settings, the log and pytest results (including a real
  pytest run when `python3` has pytest); each test sits next to the code it covers.
- `npm run test:ui` runs `tests/ui/<area>.test.mjs` with `node --test`, against the built
  interface in headless Chrome. `tests/mock/` implements the same commands and events as the
  Rust backend, one file per area, over a shared fixture folder (`fixture.js`).
- `npm run preview -- --out shot.png --scenario <name>` renders a scenario from
  `scripts/scenarios/` against the same mock, for looking at visual changes.
- `npm run smoke` drives the real app, with a real terminal, pytest and tutor (`smoke.js`).
