// A one-line text field at the top of the file tree, used to name new and renamed items.

import { h } from '../dom.js';
import { showPanel, showStatus } from '../shell/index.js';
import { showView, treeView } from './panel.js';

/**
 * Asks for a path, starting from `initial` with the characters in `[start, end]` selected.
 * Enter calls `onDone(path)`; Escape or leaving the field cancels. Errors go to the status bar.
 */
export function askForName(initial, [start, end], onDone) {
  treeView.querySelector('.new-name')?.remove();
  showPanel('files');
  showView('tree');
  const input = h('input', { class: 'new-name text-input', placeholder: 'path/to/name', spellcheck: 'false' });
  input.value = initial;
  treeView.prepend(input);
  input.focus();
  input.setSelectionRange(start, end);

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    const name = input.value.trim().replace(/^\/+|\/+$/g, '');
    input.remove();
    if (commit && name) onDone(name).catch((e) => showStatus(String(e), 8000));
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  };
  input.onblur = () => finish(false);
}
