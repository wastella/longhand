# Architecture

Longhand is a [Tauri 2](https://tauri.app) app: a Rust process that owns everything with side
effects, and a web interface in the system webview that owns everything on screen.

```
┌───────────────────────────── interface (src/renderer) ─────────────────────────────┐
│  shell/  layout, panels, title and status bars, welcome, text size, commands       │
│  editor/ · files/ · terminal/ · tests/ · tutor/ · language/   one directory each   │
│  state.js  shared state + event bus          backend.js  the only door to Rust     │
└───────────────────┬────────────────────────────────────────────▲───────────────────┘
            commands (invoke)                               events (emit)
┌───────────────────▼────────────────────────────────────────────┴───────────────────┐
│                              backend (src-tauri/src)                               │
│  main.rs       start-up and command registration                                   │
│  workspace.rs  the open folder, per-folder config, usage log                       │
│  prefs.rs      app settings, recent folders, layout (app data directory)           │
│  files.rs      file commands, in_workspace, quick open, find in files, watching    │
│  menu.rs       the native menu; item ids become `menu` events                      │
│  system.rs     confirm dialog, opening links, window theme, self-test result       │
│  term.rs       up to four login shells on pseudo-terminals                         │
│  pytest.rs     `uv run pytest` → parsed results                                    │
│  tutor.rs      `claude -p` with read-only tools → streamed answer                  │
│  lsp.rs        language servers found on the machine, started and relayed          │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## The interface

`index.html` holds only the root regions: `#titlebar`, `#files`, `#editor`, `#welcome`,
`#bottom`, `#tutor` and `#status`. `main.js` mounts each area into its region, then asks the
backend for start-up state. Each area builds its own markup in its `mount()`.

| Area        | Owns                                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shell/`    | Layout and splitters, panel toggles, bottom panel tabs, title and status bars, welcome and folders, settings, theme, notifications, focus, shortcuts, the command registry and shared components |
| `editor/`   | CodeMirror setup and languages, tabs, saving, reloading files changed on disk, the unsaved-changes quit prompt                                                                                   |
| `files/`    | File tree, its context menu and naming field, quick open, find in files, watching the folder                                                                                                     |
| `terminal/` | xterm.js and the shell session                                                                                                                                                                   |
| `tests/`    | Running pytest and showing results                                                                                                                                                               |
| `language/` | Language servers: starting them, keeping them in step with the open files, problems, definitions and the status-bar item                                                                         |
| `tutor/`    | The tutor engine client, conversation, lookup bar, history and record, Markdown and math with the hidden-code check, setup                                                                       |

How areas talk to each other:

- **Events** (`on`, `once`, `emit` in `state.js`) say what happened: `workspace:opened`,
  `editor:active`, `editor:cursor`, `editor:opened`, `editor:changed`, `tests:finished`, `tutor:finished`, `usage:changed`,
  `auth:changed`, `panel:toggled`, `text-size:changed`, `theme:changed`, `settings:changed`. The
  list with payloads is at the top of `state.js`.
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
- **The tutor is read-only.** Every run passes `--tools Read,Glob,Grep --restricted
--strict-mcp-config --disable-slash-commands --permission-mode dontAsk` (`tutor/cli.rs`, where
  a test pins the exact argument list). When the CLI reports its tool list at start-up, anything
  outside those three kills the run. A CLI whose `--help` lacks one of the flags the tutor relies
  on is refused as too old.
- **The user's login, never a key.** `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` are removed
  from the tutor's environment so a stray key cannot be billed by accident.
- **The window shows only the app.** Navigation away from the bundled page is refused, the content
  security policy allows no remote or inline script, and tutor answers are sanitized before they
  are rendered (`tutor/markdown.js`). Links open in the browser.

## The tutor engine

Everything that asks the tutor something goes through one function in `tutor/index.js`:

```js
import { tutorRequest, renderAnswer } from '../tutor/index.js';

const { done, cancel } = tutorRequest({
  thread: 'note-stats_running_py-12', // caller-chosen: letters, digits, - and _
  kind: 'review', // 'conversation' | 'lookup' | 'review' | 'failure'
  prompt, // the full text for the model, <context> included
  question, // optional: what the student wrote, for the transcript
  context, // optional: short labels for what was attached
  model, // optional: 'haiku' | 'sonnet' | 'opus'
  about, // optional: what the usage log files it under (defaults to the kind)
  onText: (text, delta) => renderAnswer(node, text, message), // the answer so far
  onActivity: ({ tool, target }) => {}, // the tutor is reading or searching a file
});
const { status, text, error } = await done; // status: 'done' | 'cancelled' | 'error'
```

- **Threads are independent.** Each request runs its own CLI process, so threads run at once and
  `cancel()` stops only its own. Within a thread requests take turns: a new one stops the one
  running there and waits until it has saved its answer (as stopped) before adding its question.
- **Kinds shape the prompt.** The kind picks a paragraph of the system prompt (`tutor/prompt.rs`),
  which is fixed for the life of a CLI session, so a thread keeps one kind. Lookups use haiku at
  low effort, get **no tools** (`--tools ""`: they answer about the language, libraries, tools,
  errors and concepts, not the folder), never keep a CLI session, and have a tight framing that
  turns "write my assignment step" into one sentence pointing to the tutor panel. The others use
  the folder's model and the read-only tools.
- **Threads are kept** (unless `ephemeral`) in `.longhand/threads/<id>.json`: the transcript and
  the CLI session id. Lookups are kept too, one thread a day (`lookup-YYYY-MM-DD`). A later
  request resumes the session. If the CLI no longer has it, or the policy changed since it
  began, a fresh session starts with the transcript as context, and the request gets
  `onRestart()`. `listThreads(prefix)` and `loadThread(id)` read them back. Kept: 400 messages a
  thread, 64 000 characters a message, 300 threads a folder (the least recently used go).
- **`.longhand/` is untrusted.** A starter repository can ship it. A loaded thread keeps a session
  id only if it is a plain UUID (passed as `--resume=<id>`, never as a separate argument), a
  policy and kind only from their allow-lists, and messages only with a known role; a session
  resumes only under the policy it was started with. Only `"guided"` in `config.json` loosens the
  policy. `.longhand/.gitignore` (`*`) is written when the folder is created.
- **Fail closed.** Nothing the model writes is passed on until the CLI's init message has listed
  its tools and they are a subset of Read, Glob and Grep; a missing list stops the run.
- **Failures are specific.** `error.code` is one of `not-installed`, `too-old`, `logged-out`,
  `rate-limited` (with `resetsAt`, seconds since the epoch), `offline`, `busy`, `read-only`,
  `no-folder`, `invalid` or `failed`; `error.message` is a sentence a student can act on.
  `tutor/errors.js` turns one into a message with the action that helps.
- **Render with `renderAnswer`.** It sanitizes, draws math (KaTeX, bundled into `dist/katex/`),
  colours Python (the editor's parser, tag groups and `--color-code-*` tokens, so answers and the
  editor look alike), and applies the hidden-code check (`tutor/hidden-code.js`): code is counted
  across the whole answer (code blocks, shell-labelled blocks whose body is Python, inline code
  forming its own line or a statement, `<code>` with `<br>`, and `\texttt`/`\verb`/code-like text
  in math), and when it exceeds the policy (2 lines on Strict, 12 on Guided) all of it stays
  behind one button that logs the reveal. Anything shown to the student must go through it.
  `message` is `{ revealed: new Set(), streaming }`.
- **Every request is logged** as `kind: "ask"` in `.longhand/log.jsonl`, with `about` and
  `requestKind` (`tutor::log_ask`; `log_event` never lets a detail replace an entry's `kind`).
  `usageRecord()` returns the folder's use by day. The Record view and the title bar's counts
  both read the log through `tutor/record.rs`, so they cannot disagree; clicking the title bar's
  count opens the Record (the `show-record` command). Entries from older versions (`about:
"hint"`, a `rung`) are still counted, under their own label.
- **Speed.** The CLI takes about 0.2–0.5 s to start and the first token follows about 0.5–1 s
  later on haiku. `prepareTutor('lookup')` starts the CLI ahead of a lookup (the lookup bar does
  this when it opens), so only the model's latency remains.

The backend side is `tutor.rs` (commands `tutor_request`, `tutor_prepare`, `tutor_cancel`,
`tutor_threads`, `tutor_thread`, `tutor_record`, `auth_status`) and `tutor/`: `cli.rs` (finding
and checking the CLI, the arguments), `stream.rs` (reading its stream-json), `run.rs` (one
request), `threads.rs`, `failure.rs`, `prompt.rs` and `record.rs`. Events arrive as
`tutor:event` with `{ thread, request, type }`; the client in `tutor/engine.js` sorts them out.

The panel's header holds the policy (Strict or Guided, with its one-line note beneath), History
and New. Explain, Review and failure help are not buttons in the panel: they live where the work
is (the selection's actions and ⌘E, ⇧⌘R and the Notes list, the failing test), and the panel's
empty state names their shortcuts. The conversation panel uses one `conv-…` thread at a time and
reopens the folder's latest on start. It adds context to each question inside `<context>` tags (`tutor/context.js`): the open
file, the cursor line and any selection; the row above the question
box shows these and lets the student leave any out. `evals/` measures how well the prompt holds
against attempts to get the assignment's code (see `evals/README.md`).

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
  as on disk, or `{ kind, mtime, size }` with `kind` one of `binary`, `tooLarge` (over 3 MB, or
  20 MB for a `.ipynb`, with the `limit` that applied; only the first 8 KB is read to tell binary
  from text) or `notText` (not UTF-8), or
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
  `source` (any name, such as `'review'`) had there. A note is `{ id, fromLine, toLine, body,
kind?, head?, actions? }`: 1-based inclusive lines and a DOM node the caller owns and may keep
  updating (the editor re-measures when it grows). `head` and `actions` are DOM nodes placed in
  the card's top row, after its lines and before Hide. Each note shows a bar in the gutter and a
  faint tint on its lines. `kind` `'bug'`, `'fragile'` or `'good'` colours the bar with the
  danger, warning or success token; any other note is neutral. Overlapping notes sit side by
  side in up to three lanes;
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
- `showNote(source, path, id, { keepCursor })` opens the file and that note, scrolled into view.
  The cursor moves to the note unless `keepCursor`.
- `openText(path)` is the text of an open file as the editor holds it, unsaved edits included,
  or null when it is not open as text.
- `registerSelectionAction({ id, label, run })` adds a button to the small row offered beside a
  selection once it has settled (and the mouse is up). `run({ path, fromLine, toLine, text })`
  gets the selected lines; a selection ending at the start of a line does not include it. The
  row hides as soon as the student types or moves the cursor, never takes focus on its own, and
  appears only when at least one action is registered. Alt+Enter moves focus to it; Escape goes
  back to the code. Returns a function that removes the action.

The interface tests and previews reach these through `window.__editor`, which exists only
under the mock backend.

### Files another area draws

`registerCustomEditor(extension, open)` (from `editor/index.js`) gives a kind of file its own
view in place of the CodeMirror view; notebooks use it. The editor still owns the tab, the
reading and writing, the dirty mark, changed-on-disk checks, the banners and the leave guard.
`open({ path, text, format, changed })` is called with the file as read and returns either
`{ notice }` (the file cannot be shown this way; the tab shows the notice with an Open as Text
button, which reopens it in CodeMirror, in the same place) or an object with `dom`,
`snapshot()` (`{ text, mark }`: the file's text now and a mark for `markSaved(mark)` once that
text is on disk), `dirty()`, `version()` (changes whenever the content does, so a save that
raced an edit stays dirty), `load(text)` (the disk's version, after a reload; returns
`{ notice }` if it is no longer readable), `show()`, `hide()`, `rename(path)`, `close()`,
`running()` (closing asks first while true) and `place()` (where the student is, in words, for
the tutor's context). It calls `changed()` after every change. Custom docs are not announced
through `editor:opened` and the rest, so language servers do not see them.

`createCellState(text, { language, keys, onUpdate })` and `refreshCellTheme(view)` give a small
editor the main editor's look and editing keys, without what belongs to a whole file (find,
go to line, notes).

## Notebooks

`.ipynb` files open as cells (`renderer/notebook/`). The file format is nbformat 4, and saving
writes exactly what Jupyter would: `notebook/json.js` parses JSON keeping each number's text
and writes it as Python's `json.dumps(sort_keys=True, indent=1, ensure_ascii=False)` does;
`notebook/format.js` splits and joins multi-line strings as nbformat does and drops what it
drops (`metadata.trusted`, `orig_nbformat`, `signature`). A notebook nbformat wrote comes back
byte for byte, and everything Longhand does not understand (metadata, attachments, ids,
outputs of unknown types) is kept as it was. A file that is not JSON, not nbformat 4, or over
20 MB opens as a notice with Open as Text.

`notebook/model.js` holds the cells. Each cell's text lives in its own CodeMirror state (with
its own undo history); adding and deleting cells go on the notebook's undo stack, which keeps
the cell objects, so undoing a deletion brings back the text and outputs (not the cell's typing
history, which goes with its editor). Deleting the last cell leaves an empty one in the same
change, so a notebook never has no cells; the Undo on a deletion's notice undoes that deletion,
whatever was done since. Keys
inside a cell are the editor's, plus Shift+Enter (run, then the next cell) and Cmd+Enter or
Ctrl+Enter (run in place). Cmd+Z outside a cell's editor undoes adding and deleting cells.
There is no Jupyter command mode.

Outputs are drawn by `notebook/output-view.js`. Nothing in a notebook may run script, load
from the network or navigate: HTML and Markdown go through DOMPurify (`notebook/safe-html.js`)
with scripts, styles, SVG, forms and frames removed, images kept only as raster `data:` URLs,
and links that open in the browser (http and https only) or do nothing; SVG output is shown as
an `<img>`, where it cannot run script; JavaScript and widget outputs get a placeholder. The
CSP (`img-src 'self' data:`) is the second line. Stream text follows `\r` and `\b` as a
terminal does, long text shows its first 100 and last 200 lines with Show all, and stored
stream text is capped at 500 KB.

### Kernels

`notebook.rs` runs one Python kernel per open notebook, started only when the student runs a
cell (opening a notebook from anywhere must not run its code) and stopped when its tab closes,
when another folder opens, and on quit. At most 3 run at once. The kernel is ipykernel in the
folder's own Python: from the login shell, `uv run python` when the folder has a
`pyproject.toml` or `uv.lock`, `python3` otherwise, running a small helper
(`notebook/kernel.py`, passed with `-c` through the environment, so there is no file of it
anyone could change) with the notebook's folder as the working
directory. The helper uses jupyter_client to start the kernel and relays its messages as
line-delimited JSON over stdio (the protocol is at the top of `kernel.py`), so the app needs
no ZeroMQ. jupyter_client comes with ipykernel, so the one thing a folder needs is ipykernel;
without it the helper says so and the notebook shows the command (`uv add --dev ipykernel` or
`python3 -m pip install ipykernel`) with Put in Terminal. Nothing is cached, so the next run
after installing finds it.

- `notebook_start(id, path)` starts the helper for notebook `id` (an id the interface makes).
  Fails with a sentence when 3 kernels are running.
- `notebook_send(id, message)`: `{ op: 'execute', run, code }` or `{ op: 'interrupt' }`.
- `notebook_ack(id, bytes)`: the interface has handled that many bytes; reading pauses while
  too much is unacknowledged, as for terminals.
- `notebook_stop(id)` stops the helper's process group and the kernel's (jupyter_client starts
  it in a session of its own; the helper names it as soon as it exists, before the kernel is
  ready), so whatever the kernel started goes too. The helper also shuts the kernel down on
  SIGTERM.
- Events: `notebook:message` `{ id, message, bytes }` for each helper line, and `notebook:exit`
  `{ id, code, signal, problem, kernel }` when the helper ends, with `problem`
  (`{ kind, title, detail, fix }`) when it never got a kernel running and `kernel`
  (`{ code, signal }`) when the kernel died.

The helper caps a single output's stream text at 1 MB and rich data at 5 MB, runs cells with
`stop_on_error` (cells queued behind an error are not run, as in Jupyter) and without stdin:
code that calls `input()` fails with one line saying notebooks in Longhand cannot ask for
input. Its output is written by a thread of its own: while more than 2 MB waits for the window,
further stream text is counted rather than kept (one line says how much), and commands are read
on another thread, so Interrupt works however much a cell prints. Interrupt sends SIGINT to the
kernel's process group, as jupyter_client does, and the notebook offers a restart if Python has
not stopped after 5 seconds. `notebook/kernel.js` keeps the queue, the running cell, durations
and the kernel's state, and starts one kernel at a time: a kernel stopped while it was starting
is stopped again once the backend has it, and messages from a kernel that is no longer the
notebook's are ignored. In the interface a cell keeps its last 199 outputs (one line counts the
rest), outputs are drawn once per frame, and HTML over 1 MB is not drawn.

## Language servers

Errors underlined as the student types, documentation on hover, go to definition and completion
come from the language servers already on the machine. Longhand never bundles or downloads one.
Deliberately absent: quick fixes, rename, formatting, inlay hints and anything else that writes
code for the student. Completion inserts the name chosen and nothing more: snippets are not
offered to the server and the edits a server attaches to an item (added imports) are dropped.

**Python only, for now.** Another language is a `Kind` (with a line in `parse` and an arm in
`find`) in `lsp/discover.rs`, and its entries in `language/kinds.js`; the rest is shared.

**Nothing runs until the student says so, per folder.** A language server runs the folder's
code: Pyright and pylsp start the folder's interpreter, and Longhand prefers a server installed
in the folder itself. So a folder starts with code checking off. `lsp_start` answers `{ status: 'off' }`
without looking for anything, and looking for a server never executes a program that belongs to
the folder or runs anything inside it. The decision is kept per folder path in the app's own
`state.json` (`prefs.rs`, `codeChecking`), never in the folder, and the check is in `lsp.rs`, so
the page cannot start a server for a folder that was not turned on. Once it is on, the folder is
trusted: its `.venv` servers are used, and the servers run its code.

**The backend is a transport** (`lsp.rs` and `lsp/`). It knows nothing of the protocol beyond its
framing.

- `lsp_consent()` answers `'on'`, `'off'` or `null` (not decided) for the open folder, and
  `lsp_consent_set(on)` records the decision; turning it off stops the folder's servers.
- `lsp_start(kind, look)` finds and starts the server for `python` in the open folder, one per
  kind. It answers
  `{ status: 'started', id, server, path, root, python }`, `{ status: 'missing' }`,
  `{ status: 'failed', message }` or `{ status: 'off' }`. `look` says what to do about the search
  path after a miss: `remembered` uses the one already read, `fresh` asks the login shell again
  if it was last asked more than 15 seconds ago, and `now` asks it at once.
  `lsp_send(id, message)` writes one JSON-RPC message,
  `lsp_stop(id)` ends the server, and the events are `lsp:message` (`{ id, message, bytes }`) and
  `lsp:exit` (`{ id, code, stderr }`, not sent for a server Longhand stopped on request).
- `lsp/discover.rs` decides which executable. Python looks in the folder's own environment first
  (`.venv/bin`, `venv/bin`, then an active `VIRTUAL_ENV`), then the search path, for
  `basedpyright-langserver`, `pyright-langserver` and `pylsp` in that order. Looking only checks
  which files exist; it runs nothing. The search path is the login shell's PATH
  (`lsp/search_path.rs`), followed by `/opt/homebrew/bin`, `/usr/local/bin` and `~/.local/bin`.
  Relative entries of the path are never searched, so the folder supplies a server only from the
  places named above.
- Asking the login shell (`lsp/probe.rs`) runs in its own session with a time limit, and the
  whole group is killed when it passes.
- The Python server is started with the folder's environment active (`VIRTUAL_ENV`, its `bin`
  first on the path), which is what makes `import torch` resolve against the project's `.venv`.
- `lsp/process.rs` runs one server: a reader thread decoding frames (`lsp/framing.rs`, 64 MB a
  message at most), a writer thread, and the last of its stderr kept for the exit report. The
  interface acknowledges what it has handled (`lsp_ack`) and the reader waits while more than
  4 MB is unhandled; a server that stops reading its input is killed once 16 MB is queued. Every
  server is stopped when another folder opens and in `stop_processes`.

**The interface** (`src/renderer/language/`) speaks the protocol, using `@codemirror/lsp-client`
for hover, completion and signature help.

- `servers.js` owns the lifecycle: a server starts when the first file of its kind opens and
  stops 30 seconds after the last one closes. A crash restarts it after 1, 5 and 15 seconds; more
  than three within three minutes and it gives up with one notification and "language server
  stopped" in the status bar, where a sheet shows what the server last printed and offers Start
  Again. The policy lives here rather than in the backend because a restart has to initialize
  the server and reopen its files. A server that exits before the page has its id is treated the
  same way. `environment.js` follows the folder's Python environment and `install.js` looks
  again for a missing server.
- `consent.js` is the asking: with code checking undecided, the first file a server could check
  brings one notification, which opens the sheet that turns it on. Keep Off is remembered and
  asks nothing again; File > Code Checking for This Folder… opens the same sheet to turn it off
  or on later, and there it also says when a server is not installed, with a way to the install
  sheet.
- `documents.js` is the library's `Workspace`. The editor has one view and a state per file, so
  it reads the text of each open file from the editor (`fileState`), unsaved edits included, and
  sends changes 300 ms after the typing pauses or just before any request. An edit never begins
  or ends inside a surrogate pair. It follows
  `editor:opened`, `editor:changed`, `editor:renamed`, `editor:closed` and `editor:saved`; a
  rename closes the file under the old name and opens it under the new one.
- `problems.js` turns `textDocument/publishDiagnostics` into `@codemirror/lint` diagnostics on
  the file's state, so a tab in the background has them when it is shown. Results for an older
  version of the text are dropped, hints are left out, and positions are mapped through edits
  not yet sent. An error or warning is a wavy underline and a coloured line number; the review
  notes keep the gutter's bar and the line's tint, so the two do not collide.
- `definition.js` handles Go to Definition (F12, or ⌘-click) and Go Back (⌃-). A definition
  outside the open folder is named in the status bar and not opened: the editor shows only the
  folder's files.
- `status.js` is the status-bar item: the count of problems when there are any (a click goes to
  the next), or a warning when a server would not start or was given up on. Otherwise it is
  hidden: nothing while a server starts, when a file has no problems, when checking is off, or
  when no server is installed. A missing server is said once per folder, in a notification
  (remembered in local storage as `longhand.missingServerTold`), whose sheet has the one install
  command and Put in Terminal, which types the command into a terminal without running it. A
  missing server is looked for again when the window regains focus and when
  another file of its kind opens (both `remembered`: the login shell is not run again), for
  three minutes after Put in Terminal (`fresh`), and on Check Again (`now`).
- Pyright asks the editor which Python to use (`workspace/configuration`); the answer is the
  folder's interpreter. A change to the environment on disk (`.venv`, `uv.lock`,
  `pyproject.toml`, …) makes the interface send `workspace/didChangeConfiguration`, which has
  Pyright look again at what can be imported, and a folder that only now has a `.venv` gets its
  server started again inside it.
- Server requests the interface does not serve (`workspace/applyEdit`, `window/showDocument`,
  …) are answered "method not found" by `transport.js`, and `window/showMessage` is dropped.
  The client library has no setting for leaving capabilities out, so `servers.js` removes
  formatting, rename, references and the like from the `initialize` request as it is sent.
  Documentation from a server is untrusted: it is sanitized, and links and images are dropped.
- The setting "Check code as I type" (`language.servers`) turns all of this off.

The editor's side is small: `registerFileExtension(provide)` adds CodeMirror extensions per file
and returns a function that recomputes them, and `fileState`, `fileView` and `updateFile` read
and change an open file whether or not its tab is showing. Without a server, or for a language
without one, completion falls back to the editor's own (Python names, words in the file).

Tests: `tests/mock/language.js` is a scripted server behind the same commands and events.
`cargo test` starts a real Python server when `LONGHAND_TEST_PYTHON_FOLDER` names a folder
whose `.venv` has one and the `attrs` package.

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
results; `list.js` and `detail.js` draw the two sides. Saving a file (`editor:saved`), or a
change on disk outside the editor (`files:changed`) to Python code or test configuration, marks
results that ran before it as possibly out of date; caches, environments and `.longhand/` are
left out, since a run writes `.pytest_cache` and `__pycache__` itself. A run starts by saving
every open file; if any save fails, it does not start and the panel says why, rather than
testing the old code on disk.

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
  `dispose` may return a node: the panel then shows it beneath the test, now passing, until the
  test fails again, goes, or another folder opens; the node is then sent a `panel-removed` event
  so it can stop what it is doing (the feedback area's checkpoint card uses this).

## Feedback

`src/renderer/feedback/` pins the tutor's help to the student's work rather than the side
panel. Every request starts from something the student did; none of it runs in the background.
The side panel stays for conceptual questions, and every pinned conversation uses the same
parts as the panel (`.msg` bubbles, `renderAnswer` with its hidden-code check, the activity
line, Stop, errors through `failureView` with Retry, and a line saying what the tutor sees).

- **Review this file** (⇧⌘R, `review-file`) saves the file, sends it with line numbers
  (`review-format.js`) as a `review` request, and places each note as soon as its closing tag
  streams in. The tutor answers in tags, specified in `tutor/prompt.rs`:

  ```
  <note lines="12-14" kind="question">
  Markdown
  </note>
  ```

  The answer is untrusted: a note is kept only when its lines are inside the file and span fewer
  than 60, its kind is from an allow-list (otherwise `question`), its text is non-empty (cut at
  1500 characters), and it is not a duplicate; at most six; anything outside the tags is
  ignored. The first new note replaces the file's open notes that have no replies, so a failed
  or stopped review leaves the old ones, and a note the student replied to always stays. The
  tutor numbers lines as they were when the review started; each note is placed by the text of
  those lines in the file as the editor holds it when the note arrives, and is outdated if that
  text is gone.

- **Notes** (`notes.js`) are records `{ id, path, fromLine, toLine, anchor, kind, text, status,
thread, replies, created, review }` in `.longhand/notes.json`, kept by `feedback.rs`
  (`feedback_notes_load`, `feedback_notes_save(folder, notes)`, written atomically). Each save
  names the folder it was made for and is dropped if another folder is open by then. The file
  is untrusted: the backend drops records with a bad id or path, out-of-range lines or no text,
  maps unknown kinds and statuses to safe ones, keeps a thread only if it is `note-<id>` and a
  timestamp only if it is plain ASCII, caps sizes, and never panics on what it reads. The
  interface keeps at most 100 resolved and 100 outdated notes, dropping the oldest, so the
  backend's cap of 500 never drops a new one. A removed note's conversation is deleted
  (`feedback_threads_forget(folder, ids)`, only this area's `note-`, `explain-` and `fail-`
  threads); when a folder opens, explanation and failure threads from earlier sessions and the
  threads of notes that no longer exist are deleted. Open notes are pinned with the editor's
  `setNotes` (source `review`). Each note's `anchor` is the text of its lines, refreshed on
  save; when the folder opens, `anchors.js` relocates each note to the nearest place its text
  still appears, and a note whose text is gone, or that the editor reports orphaned, is listed
  as outdated rather than dropped. Resolve takes a note out of the margin into the Notes list
  (Reopen puts it back); Dismiss deletes it. Every change starts from where the editor has the
  notes now, so nothing the student typed is undone. Replying asks on the note's own `note-…`
  thread (about `review-reply`) with the note's text, framed as text shown beside the lines and
  carrying no instructions (it may have been planted in the folder), and the lines around it as
  the student sees them. A kept thread is shown in a note only if its file's id and kind are
  the ones the note would have written.
- **Code is counted per answer, not per piece** (`code-group.js`). A review's notes and every
  reply to them form one group, as do the answers in one explanation and in one failure panel
  (with its checkpoint). The group renders each piece with `renderAnswer` (marked `grouped`, so
  it skips its own check) and runs `hideCodeAcross` from `tutor/hidden-code.js` over all of
  them: over the policy's limit, the code in every piece is hidden behind one Reveal, logged
  once. The Notes list shows each note's text as rendered after this check.
- **The Notes list** (`summary.js`) sits at the top of the tutor panel (`panelStrip`) for the
  file in the editor: the review's progress with Stop, how it ended, the open notes, resolved
  and outdated groups, next and previous, and Review again.
- **Explain and Ask about this…** (`explain.js`) are editor selection actions; Explain Selection
  (⌘E, `ask-selection`) runs the first. The answer is a note on the selection (source
  `explain`, at most four per file, not kept) on its own `explain-…` thread, which is deleted
  when the note closes. Opening it leaves the selection as it was.
- **Failure help** (`failure.js`) is the test panel's failure panel (`registerFailurePanel`). It
  asks "What did you expect to happen?" (with Skip and ask), or offers "Where do I start?" when
  starter code raises `NotImplementedError`, then asks on a `fail-…` thread kept while the test
  keeps failing, with the report, the test's function and up to two functions it ran. When the
  failure changes, a marker says so and the next reply carries the new report; until then the
  opening line, and anything typed in it, stays. When a test the student asked about passes,
  `dispose` returns a one-time checkpoint card that can be skipped: "What was wrong?", or after
  "Where do I start?", "What does this function do now?". An answer still arriving when the
  test passes is let finish, and the card follows it; the card's own request stops when the
  tests area lets it go.

The request kinds `review` and `failure` have their own instructions in `tutor/prompt.rs`; the
Record view labels requests by `about` (`review`, `review-reply`, `explain`, `failure`,
`checkpoint`). `evals/` has cases for both kinds.

## App settings

App-wide data lives in the app data directory, handled in `prefs.rs`: `settings.json` holds the
settings (an area adds one with `registerSetting` from `shell/`; the settings sheet lists them)
and `state.json` the last folder, the recent folders and the panel layout. The window's size and
position are kept by `tauri-plugin-window-state`. Every way of switching folder goes through
`openFolder` in `shell/folders.js`: it checks the path is a folder (`folder_check`), then calls
`confirmLeave('folder')`, then opens it, one at a time. The menu's Open Folder only asks the
backend for a path (`workspace_choose`) and the interface opens it. Start-up never touches the
recent folders on disk (an unplugged volume could stall the launch); the interface asks for the
checked list (`recents_list`) once it is up.

Quitting works the same way. Longhand > Quit is a menu item of ours: the interface runs
`confirmLeave('quit')` and then calls `app_quit`. Closing the window (its button, or Window >
Close Window, ⇧⌘W, ours too since the system's would take ⌘W from Close Tab) goes through the
window's close-requested event, which the interface can cancel. Quit from the Dock and logging out
are carried out by macOS without asking the app, so unsaved work is not protected there. Whichever
way the app ends, `stop_processes` in `main.rs` runs once, from the window's `Destroyed` event or
`RunEvent::Exit`, whichever comes first: it stops every terminal's session, the tutor's runs and
its warm lookup process, any test run (`pytest::shutdown`, which also removes the reporter) and
the language servers.

## Per-folder data

`.longhand/config.json` holds the policy and model. `.longhand/log.jsonl` is an append-only record
of questions, test runs, reveals and setting changes. Neither leaves the machine. Both are handled
in `workspace.rs`. `.longhand/threads/` holds the tutor's kept threads (`tutor/threads.rs`), and
`.longhand/notes.json` the margin notes (`feedback.rs`).
`workspace::longhand_dir` creates the folder with a `.gitignore` of `*`, so none of it is
committed by accident; the History and Record views say where it is and how to delete it.

## Testing

- `cargo test` covers path safety, settings, the log and pytest results (including a real
  pytest run when `python3` has pytest), and the notebook helper against a real ipykernel when
  one loads (`$LONGHAND_TEST_KERNEL_PYTHON`, or `python3`); each test sits next to the code it
  covers.
- `npm run test:ui` runs `tests/ui/<area>.test.mjs` with `node --test`, against the built
  interface in headless Chrome. `tests/mock/` implements the same commands and events as the
  Rust backend, one file per area, over a shared fixture folder (`fixture.js`).
- `npm run preview -- --out shot.png --scenario <name>` renders a scenario from
  `scripts/scenarios/` against the same mock, for looking at visual changes.
- `npm run smoke` drives the real app, with a real terminal, pytest and tutor (`smoke.js`).
