// Review notes: the tutor's observations pinned to the student's lines, kept with the folder.
//
// Each note is a record ({ id, path, fromLine, toLine, anchor, kind, text, status, thread,
// replies, created }) kept in .longhand/notes.json. Open notes are pinned in the editor's margin
// (source 'review'); resolved ones leave the margin and wait in the Notes list, where they can be
// reopened. When the folder opens, each note is placed again by its anchor (anchors.js); a note
// whose code is gone is "outdated" and listed, never silently dropped. While a file is open the
// editor keeps the notes with their code; the anchors are refreshed each time the file is saved.

import { activeFile, notesOn, setNotes, showNote } from '../editor/index.js';
import { on, state } from '../state.js';
import { anchorOf, relocate } from './anchors.js';
import { noteAction, noteBody } from './note-body.js';
import { NOTE_KINDS, numbered } from './review-format.js';
import { readLines } from './source.js';
import { loadNotes, saveNotes } from './store.js';
import { threadView } from './thread-view.js';

export const SOURCE = 'review';
/** Lines of code around a note sent with a reply to it. */
const AROUND = 3;

/** id -> record. Outdated records carry `outdated: true`, which is not saved. */
const records = new Map();
/** id -> { body, thread }: what each note shows, made when first needed. */
const views = new Map();
const watchers = new Set();
let folder = null;

const changed = () => watchers.forEach((watch) => watch());
/** Calls `watch()` whenever notes are added, moved, resolved or removed. */
export const watchNotes = (watch) => watchers.add(watch);

export const newId = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const byLine = (a, b) => a.fromLine - b.fromLine || a.toLine - b.toLine;
const describe = ({ fromLine, toLine }) => (fromLine === toLine ? `line ${fromLine}` : `lines ${fromLine}–${toLine}`);
const fileName = (path) => path.split('/').pop();

/** The notes on `path`, in line order: { open, resolved, outdated }. */
export function notesOnFile(path) {
  const all = [...records.values()].filter((r) => r.path === path).sort(byLine);
  return {
    open: all.filter((r) => r.status === 'open' && !r.outdated),
    resolved: all.filter((r) => r.status === 'resolved'),
    outdated: all.filter((r) => r.status === 'open' && r.outdated),
  };
}

const save = () => saveNotes([...records.values()]);

/** Brings records up to date with where the editor has the notes now. */
function syncPositions(path) {
  for (const { id, fromLine, toLine } of notesOn(SOURCE, path)) {
    const record = records.get(id);
    if (record) Object.assign(record, { fromLine, toLine });
  }
}

/** Pins the open notes on `path` in the margin, replacing what was there. */
function pin(path) {
  const pinnedIn = folder;
  setNotes(
    SOURCE,
    path,
    notesOnFile(path).open.map((r) => ({ id: r.id, fromLine: r.fromLine, toLine: r.toLine, body: viewFor(r).body })),
    {
      onOrphaned: (id) => {
        // Another folder opening removes every note; that is not this note's code going away.
        if (pinnedIn !== state.workspace?.path) return;
        const record = records.get(id);
        if (!record) return;
        record.outdated = true;
        changed();
      },
    },
  );
}

async function replyRequest(record, text) {
  syncPositions(record.path);
  const lines = await readLines(record.path);
  const parts = [`A margin note you wrote on ${record.path}, ${describe(record)}:\n${record.text}`];
  if (lines) {
    const from = Math.max(1, record.fromLine - AROUND);
    const to = Math.min(lines.length, record.toLine + AROUND);
    const unsaved = activeFile()?.path === record.path && activeFile().dirty ? ' (as last saved; the student has unsaved edits)' : '';
    parts.push(`The code around it now${unsaved}:\n${numbered(lines.slice(from - 1, to), from)}`);
  }
  return {
    prompt: `<context>\n${parts.join('\n\n')}\n</context>\n\n${text}`,
    question: text,
    context: [`${record.path}, ${describe(record)}`],
    about: 'review-reply',
  };
}

function viewFor(record) {
  if (views.has(record.id)) return views.get(record.id);
  const thread = threadView({
    thread: record.thread,
    kind: 'review',
    placeholder: 'Reply, or ask why…',
    label: `Reply to the note on ${describe(record)}`,
    sees: () => `this note, ${describe(record)} of ${fileName(record.path)} with the lines around them, and your reply`,
    reply: (text) => replyRequest(record, text),
    onAnswer: (result) => {
      if (result.status === 'error' || !records.has(record.id)) return;
      record.replies += 1;
      save();
    },
  });
  const actions = [
    noteAction('Resolve', 'Mark this note resolved: it leaves the margin and stays in the Notes list', () => resolve(record.id)),
    noteAction('Dismiss', 'Remove this note', () => dismiss(record.id)),
  ];
  const body = noteBody({ kind: record.kind, label: NOTE_KINDS[record.kind], remark: record.text, thread, actions });
  if (record.replies) thread.restore();
  const view = { body, thread };
  views.set(record.id, view);
  return view;
}

function forget(id) {
  views.get(id)?.thread.stop();
  views.delete(id);
  records.delete(id);
}

/** Adds a note from a review of `path` (whose lines on disk are `lines`). */
export function addReviewNote(path, lines, { fromLine, toLine, kind, text }) {
  const id = newId('n');
  records.set(id, {
    id,
    path,
    fromLine,
    toLine,
    anchor: anchorOf(lines, fromLine, toLine),
    kind,
    text,
    status: 'open',
    thread: `note-${id}`,
    replies: 0,
    created: new Date().toISOString(),
  });
  pin(path);
  save();
  changed();
}

/** Before a new review of `path`: its open notes go; resolved ones are kept out of the way. */
export function clearOpenNotes(path) {
  for (const record of [...records.values()]) if (record.path === path && record.status === 'open') forget(record.id);
  pin(path);
  save();
  changed();
}

export function resolve(id) {
  const record = records.get(id);
  if (!record) return;
  syncPositions(record.path);
  record.status = 'resolved';
  pin(record.path);
  save();
  changed();
}

/** Puts a resolved note back in the margin, where its code is now, and opens it. */
export async function reopen(id) {
  const record = records.get(id);
  if (!record) return;
  const lines = await readLines(record.path);
  const place = lines && relocate(record, lines);
  record.status = 'open';
  record.outdated = !place;
  if (place) Object.assign(record, place);
  pin(record.path);
  save();
  changed();
  if (place) showNote(SOURCE, record.path, id);
}

export function dismiss(id) {
  const record = records.get(id);
  if (!record) return;
  syncPositions(record.path);
  forget(id);
  pin(record.path);
  save();
  changed();
}

/** Opens the note in the editor, scrolled into view. */
export const jumpTo = (id) => {
  const record = records.get(id);
  return record ? showNote(SOURCE, record.path, id) : false;
};

/** After `path` was saved: the anchors become the saved text of each note's lines. */
async function refreshAnchors(path) {
  if (!notesOnFile(path).open.length) return;
  const lines = await readLines(path);
  if (!lines) return;
  syncPositions(path);
  for (const record of notesOnFile(path).open) record.anchor = anchorOf(lines, record.fromLine, record.toLine);
  save();
}

/**
 * The editor follows a renamed file's notes, but says nothing about the rename. When a file is
 * shown whose margin holds notes kept under another path, those notes move with it.
 */
function followRename(path) {
  if (!path) return;
  const moved = notesOn(SOURCE, path)
    .map(({ id }) => records.get(id))
    .filter((r) => r && r.path !== path);
  if (!moved.length) return;
  const from = moved[0].path;
  for (const record of records.values()) if (record.path === from) record.path = path;
  save();
  changed();
}

/** On opening a folder: its kept notes, each placed where its code is now. */
async function enterFolder(ws) {
  for (const id of [...views.keys()]) views.get(id).thread.stop();
  views.clear();
  records.clear();
  folder = ws.path;
  changed();
  const kept = await loadNotes();
  const paths = [...new Set(kept.map((r) => r.path))];
  const files = await Promise.all(paths.map(readLines));
  if (folder !== state.workspace?.path) return;
  paths.forEach((path, i) => {
    const lines = files[i];
    for (const record of kept.filter((r) => r.path === path)) {
      const place = lines && relocate(record, lines);
      records.set(record.id, { ...record, ...(place || {}), outdated: !place });
    }
    pin(path);
  });
  changed();
}

export function setupNotes() {
  on('workspace:opened', enterFolder);
  on('editor:saved', refreshAnchors);
  on('editor:active', followRename);
}
