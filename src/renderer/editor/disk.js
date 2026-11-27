// Saving open files, and picking up changes made to them outside the editor.

import { confirm, invoke } from '../backend.js';
import { state } from '../state.js';
import { showStatus } from '../shell/index.js';
import { docState, isWithin, renderTabs, session, setDirty } from './session.js';

// Modification times from the file system can differ by rounding; anything within 1 ms is the same.
const changedSince = (onDisk, mtime) => onDisk > mtime + 1;

/** Saves `path` (the active file by default). Asks before overwriting a newer copy on disk. */
export async function save(path = session.active) {
  const doc = session.docs.get(path);
  if (!doc) return false;
  if (path === session.active) doc.state = session.view.state;
  try {
    const onDisk = await invoke('fs_mtime', { rel: path });
    if (changedSince(onDisk, doc.mtime) && !(await confirm(`${path} changed on disk since you opened it. Overwrite it with your version?`, 'Overwrite')))
      return false;
    const written = await invoke('fs_write', { rel: path, text: doc.state.doc.toString() });
    doc.mtime = written.mtime;
    setDirty(path, false);
    showStatus(`Saved ${path}`, 1500);
    return true;
  } catch (e) {
    showStatus(`Could not save: ${e}`, 8000);
    return false;
  }
}

/** Saves every file with unsaved changes at `prefix` or inside it (every file when no prefix). */
export async function saveAll(prefix) {
  for (const [path, doc] of session.docs) if (doc.dirty && (prefix == null || isWithin(path, prefix))) await save(path);
}

/** Reloads open files that changed on disk (git, a formatter), unless they have unsaved edits. */
export async function reloadChangedFiles() {
  if (!state.workspace) return;
  for (const [path, doc] of session.docs) {
    let onDisk;
    try {
      onDisk = await invoke('fs_mtime', { rel: path });
    } catch {
      continue;
    }
    if (!onDisk || !changedSince(onDisk, doc.mtime)) continue;
    if (doc.dirty) {
      showStatus(`${path} also changed on disk; saving will ask before overwriting`, 8000);
      continue;
    }
    const file = await invoke('fs_read', { rel: path }).catch(() => null);
    if (!file || file.text == null) continue;
    doc.mtime = file.mtime;
    if (path === session.active) {
      const { view } = session;
      if (view.state.doc.toString() !== file.text) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: file.text } });
      doc.state = view.state;
    } else doc.state = docState(path, file.text);
    doc.dirty = false;
  }
  renderTabs();
}
