// The status bar holds only what a student glances at while writing: the open file and whether
// it is saved, its problems when it has any, and the cursor position. Messages that need noticing are
// notifications (notify.js); showStatus keeps working for passing remarks.

import { h, spacer } from '../dom.js';
import { on } from '../state.js';
import { activeFile } from '../editor/index.js';

const file = h('span', { id: 'status-file', class: 'truncate' });
const saved = h('span', { id: 'status-saved' });
const message = h('span', { id: 'status-msg', class: 'truncate', 'aria-live': 'polite' });
const position = h('span', { id: 'status-pos' });
let clearTimer;

/** Shows `text` in the status bar for `ms` milliseconds (0 keeps it until the next message). */
export function showStatus(text, ms = 4000) {
  message.textContent = text || '';
  clearTimeout(clearTimer);
  if (text && ms) clearTimer = setTimeout(() => (message.textContent = ''), ms);
}

/**
 * Adds an item another area keeps up to date (the language server's problem count), before the
 * cursor position. Its owner hides it when it has nothing to say.
 */
export function addStatusItem(node) {
  position.before(node);
}

function showFile() {
  const active = activeFile();
  file.textContent = active?.path || '';
  saved.hidden = !active;
  saved.className = active?.dirty ? 'unsaved' : '';
  saved.textContent = active?.dirty ? 'Unsaved' : 'Saved';
}

export function mountStatusBar(region) {
  region.append(file, saved, spacer(), message, position);
  showFile();
  on('editor:active', showFile);
  on('editor:saved', showFile);
  on('editor:cursor', (cursor) => {
    position.textContent = cursor ? `Ln ${cursor.line}, Col ${cursor.col}` : '';
    showFile();
  });
  on('workspace:opened', showFile);
}
