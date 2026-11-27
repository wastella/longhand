// Notes pinned to line ranges, like a TA's pen marks in the margin. Another area supplies each
// note's body as a DOM node; the editor draws a bar in the gutter and a tint on the lines, opens
// the body beneath the range when the note is activated, and keeps the range attached to the
// code as the student edits. The editor never writes a note's content.
//
// Notes live in a registry by path, so notes for files that are not open appear when they open.
// For an open file, the file's CodeMirror state holds the live ranges and the registry is kept
// in step after every change (syncNotes).

import { RangeSet, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, WidgetType, gutter } from '@codemirror/view';
import { h, spacer } from '../dom.js';

/** path -> Map(key -> note), where a note is { key, source, id, fromLine, toLine, body, onOrphaned }. */
const registry = new Map();
const keyOf = (source, id) => `${source}\u0000${id}`;
let onRegistryChange = () => {};

const replaceNotes = StateEffect.define();
const toggleNote = StateEffect.define();
/** Opens one note (its key) and closes the rest; null closes them all. */
const openOnly = StateEffect.define();

// ---- the registry, which is what other areas talk to ----

function validate(note) {
  const ok = note && note.id != null && Number.isInteger(note.fromLine) && Number.isInteger(note.toLine) && note.fromLine >= 1 && note.toLine >= note.fromLine;
  if (!ok)
    throw new TypeError(
      `A note needs an id and 1 <= fromLine <= toLine, got ${JSON.stringify({ id: note?.id, fromLine: note?.fromLine, toLine: note?.toLine })}`,
    );
  if (!(note.body instanceof Node)) throw new TypeError(`Note ${note.id} needs a DOM node as its body`);
}

/** Replaces the notes `source` has on `path`. See setNotes in index.js. */
export function putNotes(source, path, notes, onOrphaned) {
  notes.forEach(validate);
  const byKey = new Map([...(registry.get(path) || [])].filter(([, note]) => note.source !== source));
  for (const { id, fromLine, toLine, body } of notes) byKey.set(keyOf(source, id), { key: keyOf(source, id), source, id, fromLine, toLine, body, onOrphaned });
  if (byKey.size) registry.set(path, byKey);
  else registry.delete(path);
  onRegistryChange(path);
}

/** Removes the notes `source` has on `path`, or on every file when `path` is omitted. */
export function dropNotes(source, path) {
  for (const target of path == null ? [...registry.keys()] : [path]) {
    const notes = registry.get(target);
    if (!notes) continue;
    for (const [key, note] of notes) if (note.source === source) notes.delete(key);
    if (!notes.size) registry.delete(target);
    onRegistryChange(target);
  }
}

/** Where `source`'s notes on `path` are now: [{ id, fromLine, toLine }], in line order. */
export function listNotes(source, path) {
  return [...(registry.get(path)?.values() || [])]
    .filter((note) => note.source === source)
    .map(({ id, fromLine, toLine }) => ({ id, fromLine, toLine }))
    .sort((a, b) => a.fromLine - b.fromLine);
}

/** The registry key of `source`'s note `id` on `path`, if it exists. */
export const findNote = (source, path, id) => (registry.get(path)?.has(keyOf(source, id)) ? keyOf(source, id) : null);

/** Calls `handler(path)` whenever the notes for `path` are set or cleared. */
export const watchNotes = (handler) => (onRegistryChange = handler);

/** Follows a rename of `from` (a file or folder) to `to`. */
export function moveNotes(from, to) {
  for (const path of [...registry.keys()]) {
    if (path !== from && !path.startsWith(from + '/')) continue;
    registry.set(to + path.slice(from.length), registry.get(path));
    registry.delete(path);
  }
}

/** Forgets every note, for a newly opened folder. */
export const forgetAllNotes = () => registry.clear();

// ---- ranges in an open file ----

/** Where a range [from, to] goes through `changes`, or null when its text was deleted. */
function mapRange({ from, to }, changes, startDoc) {
  // Text typed at the start of the range pushes it down; text typed at its end stays outside it.
  // An empty range (a blank line) grows to hold whatever is typed on it.
  let next = from < to ? { from: changes.mapPos(from, 1), to: changes.mapPos(to, -1) } : { from: changes.mapPos(from, -1), to: changes.mapPos(to, 1) };
  const firstLine = startDoc.lineAt(from).from;
  const lastLine = startDoc.lineAt(to).to;
  changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    if (!next || fromA > from || toA < to || fromA === toA) return;
    // One edit swallowed the whole range. Rewritten within its own lines, the note follows the
    // new text; deleted, or replaced along with code around it, the note has lost its place.
    next = inserted.length && fromA >= firstLine && toA <= lastLine ? { from: fromB, to: toB } : null;
  });
  return next;
}

function rangeFor(doc, fromLine, toLine) {
  if (fromLine > doc.lines) return null;
  return { from: doc.line(fromLine).from, to: doc.line(Math.min(toLine, doc.lines)).to };
}

class NoteMark extends GutterMarker {
  constructor(kind, title) {
    super();
    this.kind = kind;
    this.title = title;
  }
  eq(other) {
    return other.kind === this.kind && other.title === this.title;
  }
  toDOM() {
    return h('div', { class: `cm-note-mark ${this.kind}`, title: this.title });
  }
}

class NoteWidget extends WidgetType {
  constructor(note, lines) {
    super();
    this.note = note;
    this.lines = lines;
  }
  eq(other) {
    return other.note === this.note && other.lines === this.lines;
  }
  toDOM(view) {
    const collapse = h(
      'button',
      { class: 'ghost cm-note-hide', type: 'button', title: 'Hide note (Esc)', onclick: () => view.dispatch({ effects: toggleNote.of(this.note.key) }) },
      'Hide',
    );
    const dom = h(
      'div',
      { class: 'cm-note', role: 'note', 'aria-label': `Note on ${this.lines.toLowerCase()}`, 'data-note': this.note.id },
      h('div', { class: 'cm-note-head' }, h('span', { class: 'cm-note-lines' }, this.lines), spacer(), collapse),
      h('div', { class: 'cm-note-body' }, this.note.body),
    );
    // The body may grow after it is shown (an answer streaming in), so the editor re-measures.
    this.resize = new ResizeObserver(() => view.requestMeasure());
    this.resize.observe(dom);
    return dom;
  }
  updateDOM(dom) {
    if (dom.dataset.note !== String(this.note.id)) return false;
    dom.querySelector('.cm-note-lines').textContent = this.lines;
    dom.setAttribute('aria-label', `Note on ${this.lines.toLowerCase()}`);
    return true;
  }
  destroy() {
    this.resize?.disconnect();
  }
  ignoreEvent() {
    return true;
  }
}

const describeLines = (first, last) => (first === last ? `Line ${first}` : `Lines ${first}–${last}`);

/** The decorations and gutter marks for `notes`, with `open` holding the keys of opened ones. */
function draw(doc, notes, open) {
  const lineState = new Map(); // line number -> { open, start, end, title }
  const widgets = [];
  notes.forEach(({ note, from, to }, i) => {
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    const isOpen = open.has(note.key);
    for (let n = first; n <= last; n++) {
      const line = lineState.get(n) || { open: false, start: false, end: false, title: '' };
      line.open ||= isOpen;
      line.start ||= n === first;
      line.end ||= n === last;
      line.title ||= `Note on ${describeLines(first, last).toLowerCase()}: click to ${isOpen ? 'hide' : 'show'}`;
      lineState.set(n, line);
    }
    if (isOpen)
      widgets.push(Decoration.widget({ widget: new NoteWidget(note, describeLines(first, last)), block: true, side: 1 + i }).range(doc.line(last).to));
  });
  const lines = [];
  const marks = [];
  for (const [n, line] of [...lineState].sort((a, b) => a[0] - b[0])) {
    const { from } = doc.line(n);
    lines.push(Decoration.line({ class: line.open ? 'cm-note-line open' : 'cm-note-line' }).range(from));
    const kind = [line.start && 'start', line.end && 'end', line.open && 'open'].filter(Boolean).join(' ');
    marks.push(new NoteMark(kind, line.title).range(from));
  }
  return { decorations: Decoration.set([...lines, ...widgets], true), marks: RangeSet.of(marks) };
}

function build(doc, notes, open, orphaned = []) {
  notes.sort((a, b) => a.from - b.from || a.to - b.to);
  const drawn = draw(doc, notes, open);
  return { notes, open, orphaned, ...drawn };
}

function fromEntries(doc, entries) {
  const notes = [];
  const orphaned = [];
  for (const note of entries) {
    const range = rangeFor(doc, note.fromLine, note.toLine);
    if (range) notes.push({ note, ...range });
    else orphaned.push(note);
  }
  return { notes, orphaned };
}

const notesField = StateField.define({
  create: () => build(null, [], new Set()),
  update(value, tr) {
    let { notes, open } = value;
    const orphaned = [];
    let changed = false;
    if (tr.docChanged && notes.length) {
      changed = true;
      notes = notes.flatMap((entry) => {
        const range = mapRange(entry, tr.changes, tr.startState.doc);
        if (range) return [{ ...entry, ...range }];
        orphaned.push(entry.note);
        return [];
      });
    }
    for (const effect of tr.effects) {
      if (effect.is(replaceNotes)) {
        const fresh = fromEntries(tr.state.doc, effect.value);
        notes = fresh.notes;
        orphaned.push(...fresh.orphaned);
        open = new Set([...open].filter((key) => notes.some((n) => n.note.key === key)));
      } else if (effect.is(toggleNote)) {
        open = new Set(open);
        if (!open.delete(effect.value)) open.add(effect.value);
      } else if (effect.is(openOnly)) {
        open = new Set(effect.value == null ? [] : [effect.value]);
      } else continue;
      changed = true;
    }
    if (!changed) return value;
    // Orphans leave the open set too, so a stale key cannot reopen anything.
    if (orphaned.length) open = new Set([...open].filter((key) => !orphaned.some((note) => note.key === key)));
    return build(tr.state.doc, notes, open, orphaned);
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

const noteGutter = gutter({
  class: 'cm-note-gutter',
  markers: (view) => view.state.field(notesField).marks,
  domEventHandlers: {
    mousedown(view, line) {
      const { notes } = view.state.field(notesField);
      const hit = notes.find((n) => n.from <= line.to && n.to >= line.from);
      if (!hit) return false;
      view.dispatch({ effects: toggleNote.of(hit.note.key) });
      return true;
    },
  },
});

/** The notes extension for a file at `path`, starting with the notes already registered for it. */
export function notesFor(path) {
  const initial = [...(registry.get(path)?.values() || [])];
  const init = (state) => {
    const { notes, orphaned } = fromEntries(state.doc, initial);
    return build(state.doc, notes, new Set(), orphaned);
  };
  return [notesField.init(init), noteGutter];
}

/** The transaction spec that shows the registry's current notes for `path` in a state. */
export const refreshSpec = (path) => ({ effects: replaceNotes.of([...(registry.get(path)?.values() || [])]) });

/**
 * Brings the registry in line with a file's state after it changed from `before` (null for a
 * state just created) to `after`: notes that moved get their new lines, and notes whose text was
 * deleted, or whose lines are past the end of the file, are removed and reported to whoever set them.
 */
export function syncNotes(path, before, after) {
  const prev = before?.field(notesField, false);
  const next = after.field(notesField, false);
  if (!next || prev === next) return;
  const notes = registry.get(path);
  for (const { note, from, to } of next.notes) {
    note.fromLine = after.doc.lineAt(from).number;
    note.toLine = after.doc.lineAt(to).number;
  }
  for (const note of next.orphaned) {
    if (notes?.get(note.key) !== note) continue;
    notes.delete(note.key);
    if (!notes.size) registry.delete(path);
    note.onOrphaned?.(note.id, path);
  }
}

/** Moves the cursor to the next (dir 1) or previous (dir -1) note and opens it, wrapping around. */
export function moveToNote(view, dir) {
  const { notes } = view.state.field(notesField);
  if (!notes.length) return false;
  const line = view.state.doc.lineAt(view.state.selection.main.head).number;
  const starts = notes.map((n) => view.state.doc.lineAt(n.from).number);
  let index = dir > 0 ? starts.findIndex((start) => start > line) : starts.findLastIndex((start) => start < line);
  if (index < 0) index = dir > 0 ? 0 : notes.length - 1;
  openNoteAt(view, notes[index].note.key);
  return true;
}

/** Opens the note with registry key `key` (closing the others), and scrolls it into view. */
export function openNoteAt(view, key) {
  const entry = view.state.field(notesField).notes.find((n) => n.note.key === key);
  if (!entry) return false;
  const start = view.state.doc.lineAt(entry.from).from;
  view.dispatch({ selection: { anchor: start }, effects: [openOnly.of(key), EditorView.scrollIntoView(start, { y: 'start', yMargin: 80 })] });
  return true;
}

/** Closes every open note; false when none was open, so Escape can mean something else. */
export function closeNotes(view) {
  if (!view.state.field(notesField).open.size) return false;
  view.dispatch({ effects: openOnly.of(null) });
  return true;
}
