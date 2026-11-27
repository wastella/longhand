// Each line's own ending, so saving a file with mixed endings (CRLF here, LF there, a lone CR)
// changes only the lines the student edited. CodeMirror works in \n; this field remembers which
// line breaks were something else on disk, and follows them through every edit. New line breaks
// get the ending most of the file uses (`format.lineEnding` from documents.rs).

import { StateEffect, StateField } from '@codemirror/state';

const ENDINGS = { lf: '\n', crlf: '\r\n', cr: '\r' };

/** Replaces the remembered endings, e.g. after the file was reloaded from disk. */
const setEndings = StateEffect.define();

/**
 * Splits text as it is on disk into the editor's \n text and the line breaks that differ from
 * the file's usual ending: { text, endings: { usual, others: [[position of the \n, ending]] } }.
 */
export function fromDisk(raw, format) {
  const usual = ENDINGS[format?.lineEnding] || '\n';
  const others = [];
  let text = '';
  let last = 0;
  for (const match of raw.matchAll(/\r\n?|\n/g)) {
    text += raw.slice(last, match.index);
    if (match[0] !== usual) others.push([text.length, match[0]]);
    text += '\n';
    last = match.index + match[0].length;
  }
  text += raw.slice(last);
  return { text, endings: { usual, others } };
}

/** Whether a file uses more than one kind of line ending. */
export const isMixed = (endings) => endings.others.length > 0;

/** The field for a state created from `endings` (see fromDisk). */
export const lineEndingsFor = (endings) => lineEndings.init(() => endings);

/** The transaction spec part that installs new `endings` (positions in the new document). */
export const replaceEndings = (endings) => setEndings.of(endings);

const lineEndings = StateField.define({
  create: () => ({ usual: '\n', others: [] }),
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setEndings)) return effect.value;
    if (!tr.docChanged || !value.others.length) return value;
    // A line break keeps its ending while the \n itself survives; a deleted one takes its ending with it.
    const others = [];
    for (const [pos, ending] of value.others) {
      const start = tr.changes.mapPos(pos, 1);
      const end = tr.changes.mapPos(pos + 1, -1);
      if (end - start === 1) others.push([start, ending]);
    }
    return { usual: value.usual, others };
  },
});

/** The document's text with every line break as it should be on disk. */
export function toDisk(state) {
  const { usual, others } = state.field(lineEndings, false) || { usual: '\n', others: [] };
  const text = state.doc.toString();
  if (usual === '\n' && !others.length) return text;
  const special = new Map(others);
  let out = '';
  let last = 0;
  for (let pos = text.indexOf('\n'); pos >= 0; pos = text.indexOf('\n', pos + 1)) {
    out += text.slice(last, pos) + (special.get(pos) ?? usual);
    last = pos + 1;
  }
  return out + text.slice(last);
}
