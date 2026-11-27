// What a review asks for and how its answer is read. The tutor answers a review with notes in
// tags the editor can place (the format is specified in src-tauri/src/tutor/prompt.rs):
//
//   <note lines="12-14" kind="question">
//   The remark, in Markdown.
//   </note>
//
// The answer is model output, so nothing in it is trusted: a note is kept only when its lines
// are inside the file, its range is small, and it has something to say. Its kind comes from an
// allow-list, its text is only ever shown through renderAnswer, and anything outside the tags is
// ignored. A note counts only once its closing tag has arrived, so notes can be placed while the
// answer is still streaming without ever placing half of one.

/** The kinds of note, with the label each shows. */
export const NOTE_KINDS = {
  question: 'Question',
  bug: 'Possible bug',
  fragile: 'Works, but fragile',
  clarity: 'Clarity',
  good: 'Done well',
};

export const MAX_NOTES = 6;
/** Files longer than this are not sent for review in one piece. */
export const MAX_REVIEW_LINES = 1500;
const MAX_REVIEW_CHARS = 80_000;
const MAX_NOTE_CHARS = 1500;
/** A note about more lines than this is about a whole function, not a place in it. */
const MAX_RANGE_LINES = 60;

const NOTE = /<note\b([^>]*)>([\s\S]*?)<\/note\s*>/gi;
const LINES = /\blines?\s*=\s*["']?\s*(\d+)\s*(?:(?:-|–|—|to)\s*(\d+))?\s*["']?/i;
const KIND = /\bkind\s*=\s*["']?([a-z-]+)/i;

/** The file's lines as the editor counts them. */
export const splitLines = (text) => text.replace(/^﻿/, '').split(/\r\n|\r|\n/);

/** `lines` (from line `first`) with their numbers, as the tutor is shown code. */
export function numbered(lines, first = 1) {
  const width = String(first + lines.length - 1).length;
  return lines.map((line, i) => `${String(first + i).padStart(width)}  ${line}`).join('\n');
}

/** Whether `lines` can be sent for review: null when they can, or why not. */
export function tooLong(lines) {
  if (lines.length > MAX_REVIEW_LINES) return `it has ${lines.length.toLocaleString()} lines; reviews take up to ${MAX_REVIEW_LINES.toLocaleString()}`;
  if (lines.join('\n').length > MAX_REVIEW_CHARS) return 'it is too large to review in one go';
  return null;
}

/** The prompt asking for a review of `path`, whose text on disk is `lines`. */
export function reviewPrompt(path, lines) {
  return [
    '<context>',
    `File: ${path} (${lines.length} lines), saved just now. The line numbers are the editor's, added here; they are not part of the file.`,
    numbered(lines),
    '</context>',
    '',
    `Review ${path}, which I wrote: up to ${MAX_NOTES} margin notes, in the note format.`,
  ].join('\n');
}

/**
 * The notes in a review answer that can be placed in a file of `lineCount` lines:
 * [{ fromLine, toLine, kind, text }], at most MAX_NOTES, in the order given. `answer` may be
 * partial; a note counts once it is closed.
 */
export function parseReview(answer, lineCount) {
  const notes = [];
  for (const [, attributes, body] of answer.matchAll(NOTE)) {
    const lines = attributes.match(LINES);
    if (!lines) continue;
    const fromLine = Number(lines[1]);
    const toLine = lines[2] ? Number(lines[2]) : fromLine;
    if (fromLine < 1 || toLine < fromLine || toLine > lineCount || toLine - fromLine >= MAX_RANGE_LINES) continue;
    let text = body.trim();
    if (!text) continue;
    if (text.length > MAX_NOTE_CHARS) text = `${text.slice(0, MAX_NOTE_CHARS).trimEnd()}…`;
    const named = attributes.match(KIND)?.[1].toLowerCase();
    const kind = Object.hasOwn(NOTE_KINDS, named) ? named : 'question';
    if (notes.some((n) => n.fromLine === fromLine && n.toLine === toLine && n.text === text)) continue;
    notes.push({ fromLine, toLine, kind, text });
    if (notes.length === MAX_NOTES) break;
  }
  return notes;
}
