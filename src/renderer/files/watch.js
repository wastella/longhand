// Keeping the tree and quick open current when files change on disk outside the editor. The
// backend watches the folder and sends batches of changed paths; this passes them on to the
// other areas as `files:changed`.

import { invoke, listen } from '../backend.js';
import { emit, on, state } from '../state.js';
import { showStatus } from '../shell/index.js';
import { forgetListings } from './listing.js';
import { markFilesStale } from './quick-open.js';
import { renderTree } from './tree.js';

/** Saves from the editor come back from the watcher; they are not changes made outside it. */
const OWN_SAVE_WINDOW_MS = 2000;
const ownSaves = new Map();
let watching = false;

function madeOutside(path) {
  const savedAt = ownSaves.get(path);
  return savedAt === undefined || Date.now() - savedAt > OWN_SAVE_WINDOW_MS;
}

function refresh(paths) {
  forgetListings(paths);
  markFilesStale();
  return renderTree();
}

/** A batch from the backend: { root, paths }. Batches for a folder no longer open are dropped. */
function changed({ root, paths }) {
  if (!state.workspace || root !== state.workspace.path) return;
  const outside = paths.filter(madeOutside);
  if (outside.length) emit('files:changed', outside);
  return refresh(paths);
}

/** Starts watching the folder that was just opened. */
export async function watchFolder() {
  ownSaves.clear();
  watching = false;
  try {
    await invoke('fs_watch');
    watching = true;
  } catch (e) {
    showStatus(String(e), 10000);
  }
}

export function setupWatch() {
  listen('files:changed', changed);
  on('editor:saved', (path) => ownSaves.set(path, Date.now()));
  // Without a watcher (a network drive, say), coming back to the window is the cue to look again.
  window.addEventListener('focus', () => state.workspace && !watching && refresh(['']));
}
