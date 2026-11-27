// What the files area remembers per folder: which folders were expanded and which files were
// opened recently. The backend keeps it outside the student's folder.

import { invoke } from '../backend.js';
import { state } from '../state.js';

const SAVE_DELAY_MS = 500;
const MAX_RECENT = 20;

const empty = () => ({ expanded: [], recent: [] });
let memory = empty();
let saveTimer;

const paths = (value) => (Array.isArray(value) ? value.filter((p) => typeof p === 'string') : []);

/** Loads the memory of the folder that was just opened. */
export async function loadMemory() {
  clearTimeout(saveTimer);
  memory = empty();
  try {
    const saved = await invoke('files_memory_load');
    memory = { expanded: paths(saved?.expanded), recent: paths(saved?.recent) };
  } catch {
    // Nothing remembered is a fine start.
  }
  return memory;
}

function remember(patch) {
  Object.assign(memory, patch);
  const folder = state.workspace?.path;
  const snapshot = { ...memory };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => invoke('files_memory_save', { folder, memory: snapshot }).catch(() => {}), SAVE_DELAY_MS);
}

export const rememberExpanded = (expanded) => remember({ expanded: [...expanded] });

/** Recently opened files, most recent first. */
export const recentFiles = () => memory.recent;

export function rememberOpened(path) {
  remember({ recent: [path, ...memory.recent.filter((p) => p !== path)].slice(0, MAX_RECENT) });
}

/** Points recent files at their new place after a rename, or forgets them when `to` is null. */
export function moveRecent(from, to) {
  const move = (p) => (p === from || p.startsWith(from + '/') ? to && to + p.slice(from.length) : p);
  remember({ recent: memory.recent.map(move).filter(Boolean) });
}
