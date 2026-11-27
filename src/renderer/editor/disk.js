// Saving open files, and picking up changes made to them outside the editor (git, a formatter
// run in the terminal). A file with unsaved edits is never replaced without the student choosing.

import { confirm, invoke } from '../backend.js';
import { emit, state as app } from '../state.js';
import { showStatus } from '../shell/index.js';
import { becomeNotice, close, fileGone, isWithin, refreshDirty, renderChrome, session, stateOf, updateDoc } from './session.js';

// File systems round modification times differently; within a millisecond counts as the same.
const changedSince = (onDisk, mtime) => Math.abs(onDisk - mtime) > 1;

/** Saves `path` (the active file by default). Resolves true once it is on disk. */
export function save(path = session.active) {
  const doc = session.docs.get(path);
  if (doc?.kind !== 'text') return Promise.resolve(false);
  // One save at a time per file: a second Cmd+S waits for the first, then saves anything newer.
  const run = (doc.saving || Promise.resolve()).then(() => saveNow(doc));
  doc.saving = run;
  run.finally(() => doc.saving === run && (doc.saving = null));
  return run;
}

async function saveNow(doc) {
  if (!doc.dirty) return true;
  const text = stateOf(doc).doc;
  const write = (expectedMtime) => invoke('doc_write', { rel: doc.path, text: text.toString(), format: doc.format, expectedMtime });
  try {
    let result = await write(doc.missing ? null : doc.mtime);
    if (result.status === 'changed') {
      if (!(await confirm(`${doc.path} changed on disk since you opened it. Overwrite it with your version?`, 'Overwrite'))) {
        const [onDisk] = await invoke('doc_stat', { paths: [doc.path] });
        doc.banner = { kind: 'changed', mtime: onDisk.mtime };
        renderChrome();
        return false;
      }
      result = await write(null);
    } else if (result.status === 'deleted') {
      if (!(await confirm(`${doc.path} was deleted on disk. Save your version there again?`, 'Save'))) {
        await fileGone(doc);
        return false;
      }
      result = await write(null);
    }
    doc.mtime = result.mtime;
    doc.saved = text;
    doc.missing = false;
    doc.banner = null;
    refreshDirty(doc);
    renderChrome();
    showStatus(`Saved ${doc.path}`, 2000);
    emit('editor:saved', doc.path);
    return true;
  } catch (e) {
    doc.banner = { kind: 'save-failed', message: String(e) };
    renderChrome();
    showStatus(`Could not save ${doc.path}`, 8000);
    return false;
  }
}

/** Saves every file with unsaved changes at `prefix` or inside it (every file when no prefix). Resolves true if all were saved. */
export async function saveAll(prefix) {
  let ok = true;
  for (const doc of [...session.docs.values()]) if (doc.dirty && (prefix == null || isWithin(doc.path, prefix))) ok = (await save(doc.path)) && ok;
  return ok;
}

/** The smallest single change that turns `before` into `after`, so the cursor and notes stay put. */
export function minimalChange(before, after) {
  const max = Math.min(before.length, after.length);
  let start = 0;
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++;
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}

/** Replaces a doc's text with what is on disk now, keeping the cursor and scroll position. */
export async function reload(doc) {
  let file;
  try {
    file = await invoke('doc_read', { rel: doc.path });
  } catch (e) {
    file = { kind: 'error', message: String(e) };
  }
  if (session.docs.get(doc.path) !== doc || doc.kind !== 'text') return;
  if (file.kind === 'missing') return fileGone(doc);
  if (file.kind !== 'text') return becomeNotice(doc, file);
  // The editor keeps \n line breaks; the file's own are restored when it is saved.
  const text = file.text.replace(/\r\n?/g, '\n');
  const current = stateOf(doc).doc.toString();
  if (current !== text) updateDoc(doc, { changes: minimalChange(current, text), userEvent: 'reload' });
  Object.assign(doc, { saved: stateOf(doc).doc, mtime: file.mtime, format: file.format, missing: false, banner: null });
  refreshDirty(doc);
  renderChrome();
}

let checking = false;
let checkAgain = false;

/**
 * Looks for open files that changed on disk (all of them, or those in `paths`). Clean ones are
 * reloaded; one with unsaved edits gets a banner asking which version to keep.
 */
export async function checkDisk(paths) {
  if (!app.workspace) return;
  if (checking) return void (checkAgain = true);
  checking = true;
  try {
    const docs = [...session.docs.values()].filter((doc) => doc.kind === 'text' && !doc.saving && (!paths || paths.includes(doc.path)));
    if (!docs.length) return;
    const asked = docs.map((doc) => doc.path);
    const stats = await invoke('doc_stat', { paths: asked });
    for (const [i, doc] of docs.entries()) {
      const onDisk = stats[i];
      // Skip a file renamed, closed or being saved while its time was looked up.
      if (doc.path !== asked[i] || session.docs.get(doc.path) !== doc || doc.saving || onDisk.error) continue;
      if (onDisk.missing) {
        if (!doc.missing) await fileGone(doc);
      } else if (doc.missing || changedSince(onDisk.mtime, doc.mtime)) {
        if (doc.banner?.kind === 'changed' && doc.banner.mtime === onDisk.mtime) continue;
        if (!doc.dirty) await reload(doc);
        else {
          doc.missing = false;
          doc.banner = { kind: 'changed', mtime: onDisk.mtime };
          refreshDirty(doc);
          renderChrome();
        }
      }
    }
  } finally {
    checking = false;
    if (checkAgain) {
      checkAgain = false;
      checkDisk();
    }
  }
}

/** What the banner's buttons do, each given the doc it is about. */
export const bannerActions = {
  // The disk version is the one being overwritten now, so saving no longer needs to ask.
  keepMine: (doc) => {
    doc.mtime = doc.banner.mtime;
    doc.banner = null;
    renderChrome();
  },
  loadTheirs: (doc) => reload(doc),
  saveAgain: (doc) => save(doc.path),
  discard: (doc) => close(doc.path, true),
  retry: (doc) => save(doc.path),
  dismiss: (doc) => {
    doc.banner = null;
    renderChrome();
  },
};
