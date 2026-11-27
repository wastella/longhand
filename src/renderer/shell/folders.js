// Opening folders. Every way of switching folder (File > Open Folder, the welcome screen, a
// recent folder, dropping a folder on the window, `longhand <path>`, reopening the last folder)
// goes through openFolder, so areas with something to lose are asked first (leave-guards.js).

import { invoke, listen } from '../backend.js';
import { state } from '../state.js';
import { registerCommand } from './commands.js';
import { confirmLeave } from './leave-guards.js';
import { notify } from './notify.js';

/** [{ path, shortPath, name, openedAt, exists }], most recent first, as the backend describes them. */
let recents = [];
const recentListeners = new Set();

export const getRecents = () => recents;

/** Calls `listener(recents)` whenever the recent list changes. */
export const onRecentsChanged = (listener) => recentListeners.add(listener);

export function setRecents(list) {
  recents = Array.isArray(list) ? list : [];
  for (const listener of recentListeners) listener(recents);
}

export async function refreshRecents() {
  try {
    setRecents(await invoke('recents_list'));
  } catch {
    // The list stays as it was; it is only a shortcut.
  }
}

/** Removes a folder from the recent list (the folder itself is untouched). */
export async function forgetRecent(path) {
  try {
    setRecents(await invoke('recent_forget', { path }));
  } catch (error) {
    notify({ kind: 'error', message: `Could not update the recent list: ${error}` });
  }
}

/** True while a folder is being checked, confirmed or opened; a second request is ignored. */
let opening = false;

/** Whether a folder is open or on its way to opening. */
export const folderPending = () => opening || Boolean(state.workspace);

function showProblem(dir, error) {
  const known = recents.some((recent) => recent.path === dir);
  notify({ kind: 'error', message: String(error), action: known ? { label: 'Remove from Recent', run: () => forgetRecent(dir) } : undefined });
  refreshRecents();
}

/**
 * Opens the folder at `dir`. It is checked first (so dropping a file never asks about unsaved
 * work), then every area is asked whether anything would be lost. Resolves true if the folder
 * opened. Problems become notifications, unless `quiet` (the folder remembered from last time,
 * which the welcome screen then shows as missing).
 */
export async function openFolder(dir, { quiet = false } = {}) {
  if (dir === state.workspace?.path) return true;
  if (opening) return false;
  opening = true;
  try {
    await invoke('folder_check', { dir });
    if (!(await confirmLeave('folder'))) return false;
    await invoke('workspace_open', { dir });
    return true;
  } catch (error) {
    if (!quiet) showProblem(dir, error);
    else refreshRecents();
    return false;
  } finally {
    opening = false;
  }
}

/** Asks for a folder with the system picker, then opens it. */
export async function chooseFolder() {
  let dir;
  try {
    dir = await invoke('workspace_choose');
  } catch (error) {
    return notify({ kind: 'error', message: `Could not show the folder picker: ${error}` });
  }
  if (dir) await openFolder(dir);
}

/** Dropping a folder from Finder onto the window opens it. */
function setupDrop() {
  const dropping = (on) => document.body.classList.toggle('dropping', on);
  listen('tauri://drag-enter', () => dropping(true));
  listen('tauri://drag-leave', () => dropping(false));
  listen('tauri://drag-drop', ({ paths }) => {
    dropping(false);
    if (paths?.length === 1) openFolder(paths[0]);
    else notify({ kind: 'error', message: 'Drop one folder at a time to open it.' });
  });
}

export function mountFolders() {
  registerCommand('open-folder', chooseFolder);
  setupDrop();
}
