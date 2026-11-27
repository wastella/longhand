// Reading the student's files for the tutor's context: the text on disk, and the function that
// holds a given line (a test, or the code a test exercised).

import { invoke } from '../backend.js';
import { openText } from '../editor/index.js';
import { numbered, splitLines } from './review-format.js';

const MAX_BLOCK_LINES = 80;
const DEF = /^(\s*)(?:async\s+)?def\s+(\w+)/;
const indentOf = (line) => line.match(/^\s*/)[0].length;

/** A file's lines as saved, or null when it is not readable text. */
export async function readLines(path) {
  try {
    const doc = await invoke('doc_read', { rel: path });
    return doc?.kind === 'text' ? splitLines(doc.text) : null;
  } catch {
    return null;
  }
}

/** A file's lines as the student sees them now: the editor's text when it is open, else as saved. */
export async function currentLines(path) {
  const text = openText(path);
  return text == null ? readLines(path) : splitLines(text);
}

/**
 * The function around 1-based `line` of `lines`: { fromLine, toLine, name }, or null when the
 * line is not inside one. Long functions are cut at MAX_BLOCK_LINES.
 */
export function enclosingFunction(lines, line) {
  if (line < 1 || line > lines.length) return null;
  const target = lines[line - 1];
  let start = line - 1;
  // Walk up to a def indented less than the line (or the line itself, if it is a def).
  let limit = DEF.test(target) ? indentOf(target) + 1 : target.trim() ? indentOf(target) : Infinity;
  while (start >= 0) {
    const text = lines[start];
    const def = text.match(DEF);
    if (def && def[1].length < limit) break;
    if (text.trim()) limit = Math.min(limit, indentOf(text));
    start--;
  }
  if (start < 0) return null;
  const [, indent, name] = lines[start].match(DEF);
  let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || indentOf(lines[end]) > indent.length)) end++;
  while (end > start + 1 && !lines[end - 1].trim()) end--;
  return { fromLine: start + 1, toLine: Math.min(end, start + MAX_BLOCK_LINES), name };
}

/** The function around `line` of the file at `path`, as context: "label:\n numbered lines", or ''. */
export async function functionContext(path, line, label) {
  const lines = await readLines(path);
  const block = lines && line && enclosingFunction(lines, line);
  if (!block) return '';
  const where = block.fromLine === block.toLine ? `line ${block.fromLine}` : `lines ${block.fromLine}–${block.toLine}`;
  return `${label} (${path}, ${where}, ${block.name}):\n${numbered(lines.slice(block.fromLine - 1, block.toLine), block.fromLine)}`;
}
