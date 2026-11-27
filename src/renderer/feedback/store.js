// The folder's margin notes on disk (.longhand/notes.json, through src-tauri/src/feedback.rs).
// Saves are queued so two quick changes cannot land out of order, and each names the folder it
// was made for: the backend drops one that arrives after another folder opened.

import { invoke } from '../backend.js';
import { notify } from '../shell/index.js';

const SAVED_FIELDS = ['id', 'path', 'fromLine', 'toLine', 'anchor', 'kind', 'text', 'status', 'thread', 'replies', 'created', 'review'];

/** The open folder's kept notes: [{ id, path, fromLine, toLine, anchor, kind, text, status, thread, replies, created, review }]. */
export async function loadNotes() {
  try {
    return (await invoke('feedback_notes_load')) || [];
  } catch {
    return [];
  }
}

let queue = Promise.resolve();
const queued = (run) => {
  queue = queue.then(run).catch((error) => notify({ kind: 'error', message: String(error?.message || error) }));
  return queue;
};

/** Keeps `notes` (the folder's whole list) as the notes of `folder`. */
export function saveNotes(folder, notes) {
  const kept = notes.map((note) => Object.fromEntries(SAVED_FIELDS.map((key) => [key, note[key] ?? ''])));
  return queued(() => invoke('feedback_notes_save', { folder, notes: kept }));
}

/** Deletes the kept conversations `ids` of notes removed from `folder`. */
export function forgetThreads(folder, ids) {
  if (!ids.length) return queue;
  return queued(() => invoke('feedback_threads_forget', { folder, ids }));
}
