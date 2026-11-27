// What the tutor is told besides the question: the open file, the cursor, any selection, and
// anything attached (such as a failing test). It travels inside <context> tags.

import { activeFile } from '../editor/index.js';

const MAX_SELECTION_CHARS = 6000;

function describeEditor() {
  const file = activeFile();
  if (!file) return '';
  const lines = [`Open file: ${file.path} (cursor on line ${file.cursorLine})`];
  if (file.dirty) lines.push('The file has unsaved edits, so the copy on disk is older than what the student sees.');
  if (file.selection) {
    const { fromLine, toLine, text } = file.selection;
    lines.push(`Selected lines ${fromLine}-${toLine}:\n${text.slice(0, MAX_SELECTION_CHARS)}`);
  }
  return lines.join('\n');
}

/** The prompt sent to the tutor for `question`, with `attachment` ({ text }) if there is one. */
export function buildPrompt(question, attachment) {
  const context = [describeEditor(), attachment && attachment.text].filter(Boolean).join('\n\n');
  return context ? `<context>\n${context}\n</context>\n\n${question}` : question;
}
