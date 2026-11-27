// The status bar holds only what a student glances at while writing: the open file and whether
// it is saved, the tutor's policy, and the cursor position. Messages that need noticing are
// notifications (notify.js); showStatus keeps working for passing remarks.

import { h, spacer } from '../dom.js';
import { on, state } from '../state.js';
import { activeFile } from '../editor/index.js';

const file = h('span', { id: 'status-file', class: 'truncate' });
const saved = h('span', { id: 'status-saved' });
const message = h('span', { id: 'status-msg', class: 'truncate', 'aria-live': 'polite' });
const policy = h('span', { id: 'status-policy', 'data-tip': 'How much code the tutor may show. Change it in the tutor panel.' });
const position = h('span', { id: 'status-pos' });
let clearTimer;

const POLICY_NAMES = { strict: 'Strict', guided: 'Guided' };

/** Shows `text` in the status bar for `ms` milliseconds (0 keeps it until the next message). */
export function showStatus(text, ms = 4000) {
  message.textContent = text || '';
  clearTimeout(clearTimer);
  if (text && ms) clearTimer = setTimeout(() => (message.textContent = ''), ms);
}

// The policy is read from shared state each time the bar updates, so it stays current even
// before every area announces config:changed.
function showPolicy() {
  const name = state.workspace && POLICY_NAMES[state.config?.policy];
  policy.hidden = !name;
  policy.textContent = name ? `Tutor: ${name}` : '';
}

function showFile() {
  const active = activeFile();
  file.textContent = active?.path || '';
  saved.hidden = !active;
  saved.className = active?.dirty ? 'unsaved' : '';
  saved.textContent = active?.dirty ? 'Unsaved' : 'Saved';
  showPolicy();
}

export function mountStatusBar(region) {
  region.append(file, saved, spacer(), message, policy, position);
  showFile();
  on('editor:active', showFile);
  on('editor:saved', showFile);
  on('editor:cursor', (cursor) => {
    position.textContent = cursor ? `Ln ${cursor.line}, Col ${cursor.col}` : '';
    showFile();
  });
  on('workspace:opened', showFile);
  on('config:changed', showPolicy);
}
