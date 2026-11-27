// What can be done to files and folders from the tree: create, rename, move to the Trash, copy
// their path and show them in Finder.

import { confirm, invoke } from '../backend.js';
import { state } from '../state.js';
import { activeFile, closeFilesUnder, movePaths, openFile, saveAll } from '../editor/index.js';
import { notify, showStatus } from '../shell/index.js';
import { canBeHandout, openAsHandout } from '../viewer/index.js';
import { showContextMenu } from './context-menu.js';
import { forgetListings } from './listing.js';
import { moveRecent } from './memory.js';
import { askForName } from './naming.js';
import { expandTo, focusRow, moveExpanded, parentOf, renderTree, visibleRows } from './tree.js';

const isMac = navigator.platform.startsWith('Mac');
const depthOf = (dir) => (dir ? dir.split('/').length : 0);
const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1);
/** The first part of `path` below `dir`: what a name with slashes adds to `dir`'s listing. */
const topOf = (path, dir) => (dir ? dir + '/' : '') + path.slice(dir ? dir.length + 1 : 0).split('/')[0];

/** Asks for a new file's name in `dir`, or next to the open file when no folder is given. */
export function newFile(dir) {
  if (!state.workspace) return;
  if (typeof dir !== 'string') dir = parentOf(activeFile()?.path || '');
  create(dir, false);
}

export function newFolder(dir) {
  if (state.workspace) create(dir, true);
}

async function create(dir, isDir) {
  const path = await askForName({
    dir,
    depth: depthOf(dir),
    placeholder: isDir ? 'folder name' : 'file name',
    commit: (rel) => invoke('fs_create', { rel, dir: isDir }),
  });
  if (!path) return;
  forgetListings([topOf(path, dir)]);
  expandTo(isDir ? path + '/' : path);
  await renderTree();
  focusRow(path);
  if (!isDir) openFile(path);
}

export async function rename(entry) {
  const dir = parentOf(entry.path);
  const name = nameOf(entry.path);
  // Select the name without its extension, so typing replaces just that.
  const dot = name.lastIndexOf('.');
  const to = await askForName({
    dir,
    depth: depthOf(dir),
    initial: name,
    select: [0, dot > 0 && !entry.dir ? dot : name.length],
    replacing: entry.path,
    commit: async (to) => {
      await saveAll(entry.path);
      await invoke('fs_rename', { from: entry.path, to });
    },
  });
  if (!to) return;
  movePaths(entry.path, to);
  moveExpanded(entry.path, to);
  moveRecent(entry.path, to);
  forgetListings([entry.path, topOf(to, dir)]);
  expandTo(to);
  await renderTree();
  focusRow(to);
}

export async function moveToTrash(entry) {
  const what = entry.dir ? `the folder ${entry.path} and everything in it` : entry.path;
  if (!(await confirm(`Move ${what} to the Trash?`, 'Move to Trash'))) return;
  try {
    await invoke('fs_trash', { rel: entry.path });
  } catch (e) {
    return notify({ kind: 'error', message: `Could not move ${entry.path} to the Trash: ${e}` });
  }
  // Keep the focus where the student was: on the next row, or the one before.
  const rows = visibleRows();
  const at = rows.findIndex((r) => r.key === entry.path);
  const after = rows.slice(at + 1).find((r) => !r.key.startsWith(entry.path + '/'));
  const next = after?.depth >= (rows[at]?.depth ?? 0) ? after : rows[at - 1];
  await closeFilesUnder(entry.path);
  moveExpanded(entry.path, null);
  moveRecent(entry.path, null);
  forgetListings([entry.path]);
  await renderTree();
  if (next) focusRow(next.key);
}

async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // The clipboard API needs permission some webviews do not grant; the old way still works.
    const area = document.body.appendChild(Object.assign(document.createElement('textarea'), { value: text }));
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  showStatus(`Copied ${what}`, 1500);
}

const absolute = (path) => (path ? `${state.workspace.path}/${path}` : state.workspace.path);

async function reveal(path) {
  try {
    await invoke('fs_reveal', { rel: path });
  } catch (e) {
    notify({ kind: 'error', message: `Could not show ${path || 'the folder'} in the Finder: ${e}` });
  }
}

/**
 * The menu for a tree entry ({ path, dir }), or for the folder itself when `entry` is null.
 * `at` is { x, y } in the window.
 */
export function showEntryMenu(at, entry, options) {
  const dir = !entry ? '' : entry.dir ? entry.path : parentOf(entry.path);
  const make = [
    { label: 'New File…', hint: '⌘N', run: () => newFile(dir) },
    { label: 'New Folder…', run: () => newFolder(dir) },
  ];
  if (!entry) return showContextMenu(at, [...make, null, { label: isMac ? 'Reveal in Finder' : 'Show in File Manager', run: () => reveal('') }], options);
  showContextMenu(
    at,
    [
      ...make,
      null,
      ...(!entry.dir && canBeHandout(entry.path) ? [{ label: 'Open as Handout', run: () => openAsHandout(entry.path) }, null] : []),
      { label: 'Rename…', hint: 'F2', run: () => rename(entry) },
      { label: 'Move to Trash', hint: '⌘⌫', run: () => moveToTrash(entry) },
      null,
      { label: 'Copy Path', run: () => copyText(absolute(entry.path), 'path') },
      { label: 'Copy Relative Path', run: () => copyText(entry.path, 'relative path') },
      { label: isMac ? 'Reveal in Finder' : 'Show in File Manager', run: () => reveal(entry.path) },
    ],
    options,
  );
}
