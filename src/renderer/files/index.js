// The files area: the file tree and its menu, quick open, and find in files. Other areas import
// from this file only.

import { on, state } from '../state.js';
import { registerCommand, registerFocusTarget } from '../shell/index.js';
import { newFile } from './actions.js';
import { closeContextMenus } from './context-menu.js';
import { openFind, resetFind, setupFind } from './find.js';
import { forgetAllListings } from './listing.js';
import { loadMemory, rememberOpened } from './memory.js';
import { findToggle, header, newFileButton, searchInput, searchView, showView, treeView } from './panel.js';
import { forgetFiles, mountQuickOpen, openQuickOpen } from './quick-open.js';
import { renderTree, resetTree, reveal, setEmptyAction } from './tree.js';
import { setupTreeInput } from './tree-input.js';
import { setupWatch, watchFolder } from './watch.js';

async function folderOpened() {
  forgetAllListings();
  forgetFiles();
  resetFind();
  showView('tree');
  const memory = await loadMemory();
  resetTree(memory.expanded);
  watchFolder();
  await renderTree();
}

export function mount(region) {
  region.append(header, treeView, searchView);
  setupTreeInput();
  setupFind();
  setupWatch();
  mountQuickOpen();
  setEmptyAction(() => newFile(''));
  registerFocusTarget('files', () => (treeView.hidden ? searchInput : treeView));

  newFileButton.onclick = () => newFile();
  findToggle.onclick = () => (searchView.hidden ? openFind() : (showView('tree'), treeView.focus()));
  window.addEventListener('mousedown', (e) => !e.target.closest('.ctx-menu') && closeContextMenus());
  window.addEventListener('blur', () => closeContextMenus());

  registerCommand('new-file', () => newFile());
  registerCommand('find-in-files', openFind);
  registerCommand('quick-open', openQuickOpen);
  on('workspace:opened', folderOpened);
  on('editor:active', (path) => {
    if (path && state.workspace) rememberOpened(path);
    return reveal(path);
  });
}
