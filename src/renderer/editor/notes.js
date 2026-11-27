// Notes pinned to line ranges, like a TA's pen marks in the margin. Another area supplies each
// note's body as a DOM node; the editor draws a bar in the gutter and a tint on the lines, opens
// the body beneath the range when the note is activated, and keeps the range attached to the
// code as the student edits. The editor never writes a note's content.
//
// Notes live in a registry by path, so notes for files that are not open appear when they open.
// For an open file, the file's CodeMirror state holds the live ranges and the registry is kept
// in step after every change (syncNotes).
//
// A note whose code is deleted is not dropped at once: it is detached (hidden, and left out of
// notesOn) for as long as its file stays open, because the student may want the code back.
// Undo puts it back where it was, and pasting or dropping its code elsewhere moves it there, so
// a function cut and pasted keeps its note. Only when the tab closes, or another folder opens,
// is a detached note removed and reported through onOrphaned.

import { invertedEffects } from '@codemirror/commands';
import { RangeSet, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, WidgetType, gutter } from '@codemirror/view';
import { h, spacer } from '../dom.js';

/** path -> Map(key -> note), where a note is { key, source, id, fromLine, toLine, body, kind, head, actions, onOrphaned }. */
const registry = new Map();
const keyOf = (source, id) => `${source}\u0000${id}`;
/** Kinds of note with their own colour in the gutter; any other note is drawn neutral. */
const KINDS = new Set(['bug', 'fragile', 'good']);
/** Overlapping notes sit side by side in the gutter, up to this many lanes. */
const LANES = 3;
let onRegistryChange = () => {};

const replaceNotes = StateEffect.define();
const toggleNote = StateEffect.define();
/** Opens one note (its key) and closes the rest; null closes them all. */
const openOnly = StateEffect.define();
/** Puts detached notes back: [{ key, from, to }]. Undo carries it, mapped through later edits. */
const restoreNotes = StateEffect.define({
  map: (value, mapping) =>
    value.map((r) => {
      const from = mapping.mapPos(r.from, 1);
      return { ...r, from, to: Math.max(from, mapping.mapPos(r.to, -1)) };
    }),
});

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
  for (const { id, fromLine, toLine, body, kind, head, actions } of notes)
    byKey.set(keyOf(source, id), { key: keyOf(source, id), source, id, fromLine, toLine, body, kind: KINDS.has(kind) ? kind : '', head, actions, onOrphaned });
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
    .filter((note) => note.source === source && !note.detached)
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

/** Forgets every note, for a newly opened folder, telling whoever set each one. */
export function forgetAllNotes() {
  const dropped = [...registry].flatMap(([path, notes]) => [...notes.values()].map((note) => [note, path]));
  registry.clear();
  for (const [note, path] of dropped) note.onOrphaned?.(note.id, path);
}

/** A file's tab is closing with `state`: its detached notes can no longer come back. */
export function releaseDetached(path, state) {
  const notes = registry.get(path);
  for (const { note } of state?.field(notesField, false)?.detached || []) {
    if (notes?.get(note.key) !== note) continue;
    notes.delete(note.key);
    note.onOrphaned?.(note.id, path);
  }
  if (notes && !notes.size) registry.delete(path);
}

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

/** One line's marks: a bar per note covering the line, in that note's lane. */
class NoteMark extends GutterMarker {
  constructor(bars, title) {
    super();
    this.bars = bars; // [{ lane, classes }]
    this.title = title;
    this.signature = bars.map((b) => `${b.lane}:${b.classes}`).join('|');
  }
  eq(other) {
    return other.signature === this.signature && other.title === this.title;
  }
  toDOM() {
    return h(
      'div',
      { class: 'cm-note-marks', title: this.title },
      Array.from({ length: Math.max(...this.bars.map((b) => b.lane)) + 1 }, (_, lane) => {
        const bar = this.bars.find((b) => b.lane === lane);
        return h('div', { class: bar ? `cm-note-mark ${bar.classes}` : 'cm-note-mark empty' });
      }),
    );
  }
}

/** A note's DOM -> { key, resize }: which note it shows, and the observer watching its size. */
const widgetDom = new WeakMap();

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
    // CodeMirror measures a block widget without its margins, so the spacing around the card
    // is padding on a wrapper; margins would shift every line below it out of step.
    const dom = h(
      'div',
      { class: 'cm-note-block' },
      h(
        'div',
        { class: 'cm-note', role: 'note', 'aria-label': `Note on ${this.lines.toLowerCase()}`, 'data-note': this.note.id },
        h(
          'div',
          { class: 'cm-note-head' },
          h('span', { class: 'cm-note-lines' }, this.lines),
          this.note.head || null,
          spacer(),
          this.note.actions || null,
          collapse,
        ),
        h('div', { class: 'cm-note-body' }, this.note.body),
      ),
    );
    // The body may grow after it is shown (an answer streaming in), so the editor re-measures.
    // The observer belongs to the DOM, which CodeMirror may hand on to a newer widget (updateDOM).
    const resize = new ResizeObserver(() => view.requestMeasure());
    resize.observe(dom);
    widgetDom.set(dom, { key: this.note.key, resize });
    return dom;
  }
  updateDOM(dom) {
    if (widgetDom.get(dom)?.key !== this.note.key) return false;
    dom.querySelector('.cm-note-lines').textContent = this.lines;
    dom.querySelector('.cm-note').setAttribute('aria-label', `Note on ${this.lines.toLowerCase()}`);
    // setNotes may have given the same note a new body.
    const body = dom.querySelector('.cm-note-body');
    if (body.firstChild !== this.note.body) body.replaceChildren(this.note.body);
    return true;
  }
  destroy(dom) {
    widgetDom.get(dom)?.resize.disconnect();
    widgetDom.delete(dom);
  }
  ignoreEvent() {
    return true;
  }
}

const describeLines = (first, last) => (first === last ? `Line ${first}` : `Lines ${first}–${last}`);

/** The decorations and gutter marks for `notes`, with `open` holding the keys of opened ones. */
function draw(doc, notes, open) {
  const lineState = new Map(); // line number -> { open, title, bars: [{ lane, classes }] }
  const widgets = [];
  const laneEnds = []; // lane -> the last line taken in it so far
  notes.forEach(({ note, from, to }, i) => {
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    const isOpen = open.has(note.key);
    // Notes are in start order, so the first lane free by this note's first line is the lowest.
    let lane = laneEnds.findIndex((end) => end < first);
    if (lane < 0) lane = Math.min(laneEnds.length, LANES - 1);
    laneEnds[lane] = Math.max(laneEnds[lane] || 0, last);
    for (let n = first; n <= last; n++) {
      const line = lineState.get(n) || { open: false, title: '', bars: [] };
      line.open ||= isOpen;
      line.title ||= `Note on ${describeLines(first, last).toLowerCase()}: click to ${isOpen ? 'hide' : 'show'}`;
      const classes = [n === first && 'start', n === last && 'end', isOpen && 'open', note.kind].filter(Boolean).join(' ');
      if (!line.bars.some((b) => b.lane === lane)) line.bars.push({ lane, classes });
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
    marks.push(new NoteMark(line.bars, line.title).range(from));
  }
  return { decorations: Decoration.set([...lines, ...widgets], true), marks: RangeSet.of(marks) };
}

/**
 * The field's value. `notes` are the placed ones ({ note, from, to }), `detached` the ones whose
 * code was deleted ({ note, text }, with the text they covered), and `orphaned` the notes this
 * transaction lost for good (past the end of the file), for syncNotes to report.
 */
function build(doc, notes, open, orphaned = [], detached = []) {
  notes.sort((a, b) => a.from - b.from || a.to - b.to);
  const drawn = draw(doc, notes, open);
  return { notes, open, orphaned, detached, ...drawn };
}

function fromEntries(doc, entries, detached = []) {
  const notes = [];
  const orphaned = [];
  for (const note of entries) {
    if (detached.some((d) => d.note === note)) continue;
    const range = rangeFor(doc, note.fromLine, note.toLine);
    if (range) notes.push({ note, ...range });
    else orphaned.push(note);
  }
  return { notes, orphaned };
}

/** Notes whose code reappears whole in pasted or dropped text go with it. */
function reattachPasted(tr, notes, detached) {
  const back = [];
  tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    const text = inserted.toString();
    for (const entry of detached) {
      if (!entry.text.trim() || back.some((b) => b.entry === entry)) continue;
      const at = text.indexOf(entry.text);
      if (at >= 0) back.push({ entry, from: fromB + at, to: fromB + at + entry.text.length });
    }
  });
  if (!back.length) return { notes, detached };
  return {
    notes: [...notes, ...back.map(({ entry, from, to }) => ({ note: entry.note, from, to }))],
    detached: detached.filter((d) => !back.some((b) => b.entry === d)),
  };
}

const notesField = StateField.define({
  create: () => build(null, [], new Set()),
  update(value, tr) {
    let { notes, open, detached } = value;
    const orphaned = [];
    let changed = false;
    if (tr.docChanged && (notes.length || detached.length)) {
      changed = true;
      const lost = [];
      notes = notes.flatMap((entry) => {
        const range = mapRange(entry, tr.changes, tr.startState.doc);
        if (range) return [{ ...entry, ...range }];
        lost.push({ note: entry.note, text: tr.startState.doc.sliceString(entry.from, entry.to) });
        return [];
      });
      detached = [...detached, ...lost];
      if (detached.length && ['input.paste', 'input.drop', 'move.drop'].some((event) => tr.isUserEvent(event)))
        ({ notes, detached } = reattachPasted(tr, notes, detached));
    }
    for (const effect of tr.effects) {
      if (effect.is(replaceNotes)) {
        // Detached notes the registry still holds stay detached; the rest are placed afresh.
        detached = detached.filter((d) => effect.value.includes(d.note));
        const fresh = fromEntries(tr.state.doc, effect.value, detached);
        notes = fresh.notes;
        orphaned.push(...fresh.orphaned);
      } else if (effect.is(restoreNotes)) {
        for (const { key, from, to } of effect.value) {
          const entry = detached.find((d) => d.note.key === key);
          if (!entry || to > tr.state.doc.length) continue;
          detached = detached.filter((d) => d !== entry);
          notes = [...notes, { note: entry.note, from, to }];
        }
      } else if (effect.is(toggleNote)) {
        open = new Set(open);
        if (!open.delete(effect.value)) open.add(effect.value);
      } else if (effect.is(openOnly)) {
        open = new Set(effect.value == null ? [] : [effect.value]);
      } else continue;
      changed = true;
    }
    if (!changed) return value;
    // Only placed notes can be open, so a stale key cannot reopen anything.
    open = new Set([...open].filter((key) => notes.some((n) => n.note.key === key)));
    return build(tr.state.doc, notes, open, orphaned, detached);
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** Undoing an edit that detached notes puts them back where they were before it. */
const undoDetach = invertedEffects.of((tr) => {
  const before = tr.startState.field(notesField, false);
  const after = tr.state.field(notesField, false);
  if (!before || !after || before === after) return [];
  const restore = after.detached
    .filter((d) => !before.detached.some((b) => b.note === d.note))
    .map((d) => before.notes.find((n) => n.note === d.note))
    .filter(Boolean)
    .map(({ note, from, to }) => ({ key: note.key, from, to }));
  return restore.length ? [restoreNotes.of(restore)] : [];
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
  return [notesField.init(init), noteGutter, undoDetach];
}

/** The transaction spec that shows the registry's current notes for `path` in a state. */
export const refreshSpec = (path) => ({ effects: replaceNotes.of([...(registry.get(path)?.values() || [])]) });

/**
 * Brings the registry in line with a file's state after it changed from `before` (null for a
 * state just created) to `after`: notes that moved get their new lines, detached ones are marked
 * so, and notes whose lines are past the end of the file are removed and reported to whoever set them.
 */
export function syncNotes(path, before, after) {
  const prev = before?.field(notesField, false);
  const next = after.field(notesField, false);
  if (!next || prev === next) return;
  const notes = registry.get(path);
  for (const { note } of next.detached) note.detached = true;
  for (const { note, from, to } of next.notes) {
    note.detached = false;
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

/**
 * Opens the note with registry key `key` (closing the others), and scrolls it into view. The
 * cursor moves to the note's first line unless `keepCursor`.
 */
export function openNoteAt(view, key, { keepCursor = false } = {}) {
  const entry = view.state.field(notesField).notes.find((n) => n.note.key === key);
  if (!entry) return false;
  const start = view.state.doc.lineAt(entry.from).from;
  const effects = [openOnly.of(key), EditorView.scrollIntoView(start, { y: 'start', yMargin: 80 })];
  view.dispatch(keepCursor ? { effects } : { selection: { anchor: start }, effects });
  return true;
}

/** Closes every open note; false when none was open, so Escape can mean something else. */
export function closeNotes(view) {
  if (!view.state.field(notesField).open.size) return false;
  view.dispatch({ effects: openOnly.of(null) });
  return true;
}
