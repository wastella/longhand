// Reading and writing .ipynb files (nbformat 4). Everything Longhand does not use (metadata,
// cell ids, attachments, outputs it cannot show) is kept as it was read and written back, and
// the file is written as nbformat's own writer does (see json.js), so opening and saving a
// notebook Jupyter wrote gives back the same bytes, and a diff shows only real changes.

import { dumpJson, joinLines, numberOf, parseJson, splitLines } from './json.js';

/** Why a file cannot be shown as a notebook; `message` is a sentence for the student. */
export class NotebookError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

const CELL_TYPES = new Set(['code', 'markdown', 'raw']);

let nextKey = 1;
/** A key for a cell for as long as the notebook is open (cell ids are optional in the file). */
export const cellKey = () => `c${nextKey++}`;

/**
 * A cell: { key, type, source, count, outputs, rest }. `outputs` are nbformat output objects,
 * `count` the execution count (code cells), and `rest` every other field of the cell as read
 * (id, metadata, attachments, fields from later versions), written back as it was.
 */
export function makeCell(type, source = '', rest = { metadata: {} }) {
  return { key: cellKey(), type, source, count: null, outputs: [], rest };
}

function readCell(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new NotebookError('invalid', `Cell ${index + 1} is not a cell.`);
  const { cell_type: type, source, outputs, execution_count: count, ...rest } = raw;
  if (!CELL_TYPES.has(type)) throw new NotebookError('invalid', `Cell ${index + 1} has an unknown type (${JSON.stringify(type)}).`);
  const cell = makeCell(type, joinLines(source), rest);
  if (type === 'code') {
    cell.outputs = Array.isArray(outputs) ? outputs : [];
    cell.count = typeof numberOf(count) === 'number' ? numberOf(count) : null;
  }
  return cell;
}

/**
 * Reads a notebook: { cells, rest, minor }, where `rest` is the top level without its cells.
 * Throws a NotebookError for text that is not an nbformat 4 notebook.
 */
export function parseNotebook(text) {
  // An empty file (New File… named .ipynb) is a new notebook, as Jupyter would write one.
  if (!text.replace(/^\uFEFF/, '').trim()) return emptyNotebook();
  let raw;
  try {
    raw = parseJson(text.replace(/^﻿/, ''));
  } catch (e) {
    throw new NotebookError('invalid', `It is not valid JSON (${e.message}).`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new NotebookError('invalid', 'It does not hold a notebook.');
  const major = numberOf(raw.nbformat);
  if (typeof major !== 'number') throw new NotebookError('invalid', 'It does not say which notebook format it uses.');
  if (major < 4)
    throw new NotebookError(
      'old',
      `It uses notebook format ${major}, from before 2015. Open it once in Jupyter and save it to update it to format 4, which Longhand reads.`,
    );
  if (major > 4) throw new NotebookError('new', `It uses notebook format ${major}, which is newer than the format 4 Longhand reads.`);
  if (!Array.isArray(raw.cells)) throw new NotebookError('invalid', 'It has no list of cells.');
  const { cells, ...rest } = raw;
  return { cells: cells.map(readCell), rest, minor: numberOf(raw.nbformat_minor) ?? 0 };
}

/** A new notebook: one empty code cell, for Python 3, in format 4.5. */
function emptyNotebook() {
  const kernelspec = { display_name: 'Python 3', language: 'python', name: 'python3' };
  return {
    cells: [makeCell('code', '', { id: newCellId(), metadata: {} })],
    rest: { metadata: { kernelspec, language_info: { name: 'python' } }, nbformat: 4, nbformat_minor: 5 },
    minor: 5,
  };
}

/** nbformat's rejoin_lines then split_lines on a mime bundle: text, JavaScript and SVG are kept as lists of lines. */
function bundle(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const out = {};
  for (const [mime, value] of Object.entries(data)) {
    const json = mime === 'application/json' || (mime.startsWith('application/') && mime.endsWith('+json'));
    let v = !json && Array.isArray(value) && value.every((line) => typeof line === 'string') ? value.join('') : value;
    if (typeof v === 'string' && (mime.startsWith('text/') || mime === 'application/javascript' || mime === 'image/svg+xml')) v = splitLines(v);
    out[mime] = v;
  }
  return out;
}

function writeOutput(output) {
  if (!output || typeof output !== 'object') return output;
  const out = { ...output };
  if (out.output_type === 'execute_result' || out.output_type === 'display_data') {
    if ('data' in out) out.data = bundle(out.data);
  } else if (out.output_type && Array.isArray(out.text)) out.text = out.text.join('');
  if (out.output_type === 'stream' && typeof out.text === 'string') out.text = splitLines(out.text);
  return out;
}

function writeCell(cell) {
  const { metadata, attachments, ...rest } = cell.rest;
  const out = { ...rest, cell_type: cell.type, source: splitLines(cell.source) };
  // Jupyter drops this transient flag on every save.
  if (metadata && typeof metadata === 'object' && 'trusted' in metadata) {
    const { trusted, ...kept } = metadata;
    out.metadata = kept;
  } else out.metadata = metadata;
  if (attachments && typeof attachments === 'object' && !Array.isArray(attachments))
    out.attachments = Object.fromEntries(Object.entries(attachments).map(([name, data]) => [name, bundle(data)]));
  else if (attachments !== undefined) out.attachments = attachments;
  if (cell.type === 'code') {
    out.execution_count = cell.count;
    out.outputs = cell.outputs.map(writeOutput);
  }
  return out;
}

/** The notebook as nbformat writes it, with `eol` as the line break (the file's own). */
export function serializeNotebook({ cells, rest }, eol = '\n') {
  const top = { ...rest, cells: cells.map(writeCell) };
  if (top.metadata && typeof top.metadata === 'object') {
    const { orig_nbformat, orig_nbformat_minor, signature, ...metadata } = top.metadata;
    top.metadata = metadata;
  }
  return dumpJson(top, eol) + eol;
}

/** A random cell id as nbformat 4.5 makes them, for new cells in notebooks that have ids. */
export const newCellId = () =>
  crypto
    .getRandomValues(new Uint32Array(2))
    .reduce((s, n) => s + n.toString(16).padStart(8, '0'), '')
    .slice(0, 8);
