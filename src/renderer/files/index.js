// The files sidebar: the file tree, its context menu, and find in files.

import { on, state } from '../state.js';
import { registerCommand } from '../shell/index.js';
import { newFile, showEntryMenu } from './actions.js';
import { closeContextMenus } from './context-menu.js';
import { openFind, setupFind } from './find.js';
import { findToggle, header, newFileButton, searchView, showView, treeView } from './panel.js';
import { collapseAll, highlight, renderTree } from './tree.js';

export function mount(region) {
  region.append(header, treeView, searchView);
  setupFind();

  newFileButton.onclick = () => newFile();
  findToggle.onclick = () => (searchView.hidden ? openFind() : showView('tree'));
  treeView.addEventListener('contextmenu', (e) => {
    const node = e.target.closest('.node');
    if (!node) return;
    e.preventDefault();
    showEntryMenu(e, { path: node.dataset.path, dir: node.classList.contains('dir') });
  });
  window.addEventListener('mousedown', (e) => !e.target.closest('.ctx-menu') && closeContextMenus());
  // Pick up files added or removed outside the app when the window regains focus.
  window.addEventListener('focus', () => state.workspace && renderTree());

  registerCommand('new-file', () => newFile());
  registerCommand('find-in-files', openFind);
  on('workspace:opened', async () => {
    collapseAll();
    showView('tree');
    await renderTree();
  });
  on('editor:active', highlight);
}
