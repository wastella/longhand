// "Explain" and "Ask about this…" on a selection: the answer appears as a note on the selected
// lines (the same note as a review's, from another source), not in the side panel. Explanations
// are disposable: they are not kept with the folder, and closing one removes it and its kept
// conversation. The answers in one explanation are checked for code together.

import { activeFile, registerSelectionAction, setNotes, showNote } from '../editor/index.js';
import { on, state } from '../state.js';
import { showStatus } from '../shell/index.js';
import { h } from '../dom.js';
import { codeGroup } from './code-group.js';
import { noteAction, noteBody, noteHead } from './note-body.js';
import { describe, newId } from './notes.js';
import { forgetThreads } from './store.js';
import { numbered } from './review-format.js';
import { threadView } from './thread-view.js';

const SOURCE = 'explain';
/** Explanations kept open on one file; the oldest goes first. */
const MAX_PER_FILE = 4;
const MAX_SELECTION_LINES = 400;

/** path -> [{ id, fromLine, toLine, body, head, actions, thread }] */
const open = new Map();

const fileName = (path) => path.split('/').pop();

function pin(path) {
  const notes = open.get(path) || [];
  setNotes(
    SOURCE,
    path,
    notes.map(({ id, fromLine, toLine, body, head, actions }) => ({ id, fromLine, toLine, body, head, actions })),
    { onOrphaned: (id) => close(path, id) },
  );
}

function close(path, id) {
  const notes = open.get(path) || [];
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  retire(note);
  open.set(
    path,
    notes.filter((n) => n !== note),
  );
  pin(path);
}

/** An explanation is going: its answer stops and its kept conversation is deleted. */
function retire(note) {
  note.thread.stop();
  if (state.workspace) forgetThreads(state.workspace.path, [`explain-${note.id}`]);
}

/** The selected code as context, with its file and line numbers. */
function selectionContext({ path, fromLine, text }) {
  const unsaved = activeFile()?.path === path && activeFile().dirty ? ' The file has unsaved edits; this is what the student sees.' : '';
  const lines = text.split('\n');
  return `File: ${path}.${unsaved}\nSelected lines (the editor's numbers):\n${numbered(lines, fromLine)}`;
}

/** Pins a note on the selection with an empty conversation; `first` asks its first question, if any. */
async function openNote(selection, { label, placeholder, first }) {
  const { path } = selection;
  const range = { fromLine: selection.fromLine, toLine: selection.toLine };
  const id = newId('x');
  const request = (question, shown) => ({
    prompt: `<context>\n${selectionContext(selection)}\n</context>\n\n${question}`,
    question: shown,
    context: [`${path}, ${describe(range)}`],
    about: 'explain',
  });
  const thread = threadView({
    thread: `explain-${id}`,
    kind: 'review',
    placeholder,
    label: `Ask about ${describe(range)}`,
    sees: () => `${describe(range)} of ${fileName(path)} as you selected them, and your question`,
    reply: (text) => request(text, text),
    group: codeGroup('this explanation'),
  });
  const body = noteBody({ kind: 'explanation', thread });
  const actions = h(
    'span',
    { class: 'fb-note-actions' },
    noteAction('Close', 'Close and remove this note', () => close(path, id)),
  );
  const notes = [...(open.get(path) || []), { id, ...range, body, head: noteHead('explanation', label), actions, thread }];
  while (notes.length > MAX_PER_FILE) retire(notes.shift());
  open.set(path, notes);
  pin(path);
  // The selection stays as it was, so the student can still see what they asked about.
  await showNote(SOURCE, path, id, { keepCursor: true });
  if (first) thread.ask(request(first, null));
  else requestAnimationFrame(() => thread.input.focus());
}

function usable(selection) {
  if (!state.workspace) return false;
  if (!selection?.text.trim()) return (showStatus('Select some code in the editor first'), false);
  if (selection.toLine - selection.fromLine >= MAX_SELECTION_LINES) return (showStatus(`Select fewer lines to explain (up to ${MAX_SELECTION_LINES})`), false);
  return true;
}

/** Explains the selected lines in a note on them. */
export function explain(selection) {
  if (!usable(selection)) return;
  openNote(selection, {
    label: 'Explanation',
    placeholder: 'Ask a follow-up…',
    first: `Explain what ${describe(selection)} do, in plain language: what each part is for and how the values change as it runs.`,
  });
}

/** Opens a note on the selected lines for the student's own question. */
function askAbout(selection) {
  if (!usable(selection)) return;
  openNote(selection, { label: 'Your question', placeholder: `What do you want to know about ${describe(selection)}?` });
}

/** The Explain Selection command (⌘E): the editor's selection, as the selection actions get it. */
export function explainSelection() {
  const file = activeFile();
  if (!state.workspace) return;
  if (!file?.selection) return showStatus('Select some code in the editor first');
  const { fromLine, toLine, text } = file.selection;
  // A selection ending at the start of a line does not include that line, as with the actions.
  const last = text.endsWith('\n') && toLine > fromLine ? toLine - 1 : toLine;
  explain({ path: file.path, fromLine, toLine: last, text });
}

export function setupExplain() {
  registerSelectionAction({ id: 'explain', label: 'Explain', run: explain });
  registerSelectionAction({ id: 'ask-about', label: 'Ask about this…', run: askAbout });
  on('workspace:opened', () => {
    for (const notes of open.values()) notes.forEach((n) => n.thread.stop());
    open.clear();
  });
}
