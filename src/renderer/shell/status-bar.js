// The status bar: the open file on the left, passing messages and the cursor position on the right.

import { h, spacer } from '../dom.js';
import { on } from '../state.js';

const file = h('span', { id: 'status-file' });
const message = h('span', { id: 'status-msg' });
const position = h('span', { id: 'status-pos' });
let clearTimer;

/** Shows `text` in the status bar for `ms` milliseconds (0 keeps it until the next message). */
export function showStatus(text, ms = 4000) {
  message.textContent = text || '';
  clearTimeout(clearTimer);
  if (text && ms) clearTimer = setTimeout(() => (message.textContent = ''), ms);
}

export function mountStatusBar(region) {
  region.append(file, spacer(), message, position);
  on('editor:active', (path) => (file.textContent = path || ''));
  on('editor:cursor', (cursor) => (position.textContent = cursor ? `Ln ${cursor.line}, Col ${cursor.col}` : ''));
}
