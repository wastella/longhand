// The folder's margin notes on disk (.longhand/notes.json, through src-tauri/src/feedback.rs).
// Saves are queued so two quick changes cannot land out of order.

import { invoke } from '../backend.js';
import { notify } from '../shell/index.js';

const SAVED_FIELDS = ['id', 'path', 'fromLine', 'toLine', 'anchor', 'kind', 'text', 'status', 'thread', 'replies', 'created'];

/** The open folder's kept notes: [{ id, path, fromLine, toLine, anchor, kind, text, status, thread, replies, created }]. */
export async function loadNotes() {
  try {
    return (await invoke('feedback_notes_load')) || [];
  } catch {
    return [];
  }
}

let queue = Promise.resolve();

/** Keeps `notes` (the folder's whole list) as the folder's notes. */
export function saveNotes(notes) {
  const kept = notes.map((note) => Object.fromEntries(SAVED_FIELDS.map((key) => [key, note[key]])));
  queue = queue
    .then(() => invoke('feedback_notes_save', { notes: kept }))
    .catch((error) => notify({ kind: 'error', message: String(error?.message || error) }));
  return queue;
}
