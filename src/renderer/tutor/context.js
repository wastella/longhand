// What the tutor is told besides the question: the open file, the cursor, any selection, and
// anything attached (such as a failing test). It travels inside <context> tags. The student can
// leave any of these out of the next question (see composer.js).

import { activeFile } from '../editor/index.js';

const MAX_SELECTION_CHARS = 6000;

const lineRange = ({ fromLine, toLine }) => (fromLine === toLine ? `line ${fromLine}` : `lines ${fromLine}–${toLine}`);

/**
 * What the next question would carry, as chips for the composer: [{ key, label, title }].
 * `key` is 'file', 'selection' or 'attachment'; `omit` holds the keys the student removed.
 */
export function contextItems(attachment, omit) {
  const items = [];
  const file = activeFile();
  if (file && !omit.has('file')) {
    items.push({ key: 'file', label: file.path.split('/').pop(), title: `The tutor sees ${file.path}, with the cursor on line ${file.cursorLine}` });
    if (file.selection && !omit.has('selection'))
      items.push({ key: 'selection', label: lineRange(file.selection), title: `The selected ${lineRange(file.selection)} are sent with the question` });
  }
  if (attachment && !omit.has('attachment')) items.push({ key: 'attachment', label: attachment.label, title: 'Attached to the next question' });
  return items;
}

function describeEditor(omit) {
  const file = activeFile();
  if (!file || omit.has('file')) return '';
  const lines = [`Open file: ${file.path} (cursor on line ${file.cursorLine})`];
  if (file.dirty) lines.push('The file has unsaved edits, so the copy on disk is older than what the student sees.');
  if (file.selection && !omit.has('selection')) {
    const { fromLine, toLine, text } = file.selection;
    lines.push(`Selected lines ${fromLine}-${toLine}:\n${text.slice(0, MAX_SELECTION_CHARS)}`);
  }
  return lines.join('\n');
}

/**
 * The prompt sent to the tutor for `question`, with `attachment` ({ text }) if there is one, and
 * labels for the transcript. `omit` is the set of context keys the student removed.
 */
export function buildPrompt(question, attachment, omit = new Set()) {
  const file = activeFile();
  const labels = [];
  if (file && !omit.has('file')) labels.push(file.selection && !omit.has('selection') ? `${file.path}, ${lineRange(file.selection)}` : file.path);
  const attached = attachment && !omit.has('attachment') ? attachment : null;
  if (attached) labels.push(attached.label);
  const context = [describeEditor(omit), attached && attached.text].filter(Boolean).join('\n\n');
  return { prompt: context ? `<context>\n${context}\n</context>\n\n${question}` : question, labels };
}
