// One open notebook: its cells, the changes made to them, and whether it differs from the file.
//
// A cell's text lives in its CodeMirror state while it has a view (cell-view.js keeps
// `cell.source` up to date from it), so each cell keeps its own typing undo history. Adding and
// deleting cells go on the notebook's own undo stack, which holds the cell objects themselves:
// undoing a deletion brings the cell back with its text and outputs (its typing history goes
// with its editor).

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

  /** Applies a change to the list of cells and records how to undo it; returns that record. */
  apply(change) {
    const inverse = this.perform(change);
    this.undoStack.push(inverse);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.changed({ type: 'cells', focus: change.focus });
    return inverse;
  }

  /**
   * Makes a change and returns the change that undoes it. Changes name cells by object, not by
   * place, so undoing one deletion out of order cannot remove the wrong cell. The notebook never
   * has no cells: removing the last one puts an empty code cell in its place (in the same
   * change), and putting the cell back takes that empty cell away again unless it has been used.
   */
  perform(change) {
    const { cells } = this;
    if (change.op === 'insert') {
      let dropped = null;
      const filler = change.replaced ? cells.indexOf(change.replaced) : -1;
      if (filler >= 0 && !change.replaced.source && !change.replaced.outputs.length) {
        cells.splice(filler, 1);
        dropped = change.replaced;
      }
      const index = Math.min(change.index, cells.length);
      cells.splice(index, 0, change.cell);
      return { op: 'remove', cell: change.cell, replacement: dropped, focus: cells[index - 1]?.key ?? cells[index + 1]?.key ?? dropped?.key };
    }
    if (change.op === 'remove') {
      const index = cells.indexOf(change.cell);
      if (index < 0) throw new Error('The cell to remove is not in the notebook');
      cells.splice(index, 1);
      let replacement = null;
      if (!cells.length) {
        replacement = change.replacement || this.newCell('code');
        cells.push(replacement);
      }
      return { op: 'insert', index, cell: change.cell, replaced: replacement, focus: change.cell.key };
    }
    throw new Error(`Unknown change ${change.op}`);
  }

  insert(index, type) {
    const cell = this.newCell(type);
    this.apply({ op: 'insert', index, cell, focus: cell.key });
    return cell;
  }

  /** Deletes the cell; returns the record that undoes just this deletion (for `restore`). */
  remove(key) {
    const index = this.indexOf(key);
    if (index < 0) return null;
    const next = this.cells[index + 1] || this.cells[index - 1];
    return this.apply({ op: 'remove', cell: this.cells[index], focus: next?.key });
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

  /**
   * Undoes one particular change from `remove` (the Undo on its notice), whatever was done since.
   * Returns false when it was already undone.
   */
  restore(record) {
    const at = this.undoStack.indexOf(record);
    if (at < 0) return false;
    if (at === this.undoStack.length - 1) return this.undo();
    this.undoStack.splice(at, 1);
    this.redoStack = [];
    this.perform(record);
    this.changed({ type: 'cells', focus: record.focus });
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
