// Creating, renaming and trashing files and folders from the tree.

import { confirm, invoke } from '../backend.js';
import { state } from '../state.js';
import { activeFile, closeFilesUnder, movePaths, openFile, saveAll } from '../editor/index.js';
import { showStatus } from '../shell/index.js';
import { showContextMenu } from './context-menu.js';
import { askForName } from './name-input.js';
import { expandTo, renderTree } from './tree.js';

const parentOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** Asks for a new file's name, in `dir`, or next to the open file when no folder is given. */
export function newFile(dir) {
  if (!state.workspace) return;
  const near = activeFile()?.path;
  const base = typeof dir === 'string' ? (dir ? dir + '/' : '') : near && near.includes('/') ? parentOf(near) + '/' : '';
  askForName(base, [base.length, base.length], async (name) => {
    await invoke('fs_create', { rel: name, dir: false });
    expandTo(name);
    await renderTree();
    openFile(name);
  });
}

function newFolder(dir) {
  const base = dir ? dir + '/' : '';
  askForName(base, [base.length, base.length], async (name) => {
    await invoke('fs_create', { rel: name, dir: true });
    expandTo(name + '/x');
    await renderTree();
  });
}

function rename(entry) {
  const start = entry.path.lastIndexOf('/') + 1;
  askForName(entry.path, [start, entry.path.length], async (to) => {
    if (to === entry.path) return;
    await saveAll(entry.path);
    await invoke('fs_rename', { from: entry.path, to });
    movePaths(entry.path, to);
    expandTo(to);
    await renderTree();
  });
}

async function moveToTrash(entry) {
  const what = entry.dir ? `the folder ${entry.path} and everything in it` : entry.path;
  if (!(await confirm(`Move ${what} to the Trash?`, 'Move to Trash'))) return;
  try {
    await invoke('fs_trash', { rel: entry.path });
  } catch (e) {
    return showStatus(String(e), 8000);
  }
  await closeFilesUnder(entry.path);
  renderTree();
}

/** The right-click menu for a tree entry ({ path, dir }). */
export function showEntryMenu(event, entry) {
  const dir = entry.dir ? entry.path : parentOf(entry.path);
  showContextMenu(event, [
    { label: 'New File…', run: () => newFile(dir) },
    { label: 'New Folder…', run: () => newFolder(dir) },
    null,
    { label: 'Rename…', run: () => rename(entry) },
    { label: 'Move to Trash', run: () => moveToTrash(entry) },
  ]);
}
