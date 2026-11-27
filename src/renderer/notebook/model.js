// One open notebook: its cells, the changes made to them, and whether it differs from the file.
//
// A cell's text lives in its CodeMirror state while it has a view (cell-view.js keeps
// `cell.source` up to date from it), so each cell keeps its own typing undo history. Adding and
// deleting cells go on the notebook's own undo stack, which holds the cell objects themselves:
// undoing a deletion brings the cell back with its text, outputs and typing history.

import { makeCell, newCellId, parseNotebook, serializeNotebook } from './format.js';

const UNDO_LIMIT = 100;

export class Notebook {
  /** `text` is the file as read; `eol` its line break. Throws a NotebookError if it is not a notebook. */
  constructor(text, eol = '\n') {
    this.eol = eol;
    this.version = 0;
    this.listeners = new Set();
    this.replace(text);
  }

  /** Replaces everything with the notebook in `text` (the disk's version), as saved. */
  replace(text) {
    const { cells, rest, minor } = parseNotebook(text);
    this.cells = cells;
    this.rest = rest;
    this.minor = minor;
    this.undoStack = [];
    this.redoStack = [];
    this.markSaved(this.mark());
    this.changed({ type: 'reset' });
  }

  /** Calls `listener(change)` after every change; change.type is 'reset', 'cells', 'cell' or 'outputs'. */
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  changed(change) {
    this.version++;
    for (const listener of this.listeners) listener(change);
  }

  /** What the content is now, cheaply: compared with the saved mark to tell whether there are unsaved changes. */
  mark() {
    return this.cells.map((cell) => ({ cell, type: cell.type, source: cell.source, outputs: cell.outputs, count: cell.count }));
  }

  markSaved(mark) {
    this.saved = mark;
  }

  isDirty() {
    const saved = this.saved;
    if (saved.length !== this.cells.length) return true;
    return this.cells.some((cell, i) => {
      const was = saved[i];
      return was.cell !== cell || was.type !== cell.type || was.source !== cell.source || was.outputs !== cell.outputs || was.count !== cell.count;
    });
  }

  /** The file's text for the content now, and the mark that records it as saved. */
  snapshot() {
    return { text: serializeNotebook(this, this.eol), mark: this.mark() };
  }

  indexOf(key) {
    return this.cells.findIndex((cell) => cell.key === key);
  }

  /** A new, empty cell of `type`, with an id when the notebook's version has them (4.5 and later). */
  newCell(type) {
    return makeCell(type, '', this.minor >= 5 ? { id: newCellId(), metadata: {} } : { metadata: {} });
  }

  /** Applies a change to the list of cells and records how to undo it. */
  apply(change, { record = true } = {}) {
    const inverse = this.perform(change);
    if (record) {
      this.undoStack.push(inverse);
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
      this.redoStack = [];
    }
    this.changed({ type: 'cells', focus: change.focus });
    return inverse;
  }

  perform(change) {
    const { cells } = this;
    switch (change.op) {
      case 'insert':
        cells.splice(change.index, 0, change.cell);
        return { op: 'remove', index: change.index, focus: cells[change.index - 1]?.key ?? cells[change.index + 1]?.key };
      case 'remove': {
        const [cell] = cells.splice(change.index, 1);
        return { op: 'insert', index: change.index, cell, focus: cell.key };
      }
    }
    throw new Error(`Unknown change ${change.op}`);
  }

  insert(index, type) {
    const cell = this.newCell(type);
    this.apply({ op: 'insert', index, cell, focus: cell.key });
    return cell;
  }

  remove(key) {
    const index = this.indexOf(key);
    if (index < 0) return;
    const next = this.cells[index + 1] || this.cells[index - 1];
    this.apply({ op: 'remove', index, focus: next?.key });
    // A notebook always has a cell to type in.
    if (!this.cells.length) this.apply({ op: 'insert', index: 0, cell: this.newCell('code') });
  }

  undo() {
    return this.step(this.undoStack, this.redoStack);
  }

  redo() {
    return this.step(this.redoStack, this.undoStack);
  }

  step(from, to) {
    const change = from.pop();
    if (!change) return false;
    to.push(this.perform(change));
    this.changed({ type: 'cells', focus: change.focus });
    return true;
  }

  /** Sets a cell's outputs and execution count (a run started or finished). */
  setOutputs(cell, outputs, count = cell.count) {
    cell.outputs = outputs;
    cell.count = count;
    this.changed({ type: 'outputs', cell });
  }

  /** The cell's text was edited. */
  edited(cell, source) {
    cell.source = source;
    this.changed({ type: 'cell', cell });
  }
}
