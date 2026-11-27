// Saving open files, and picking up changes made to them outside the editor (git, a formatter
// run in the terminal). A file with unsaved edits is never replaced without the student choosing.
//
// Every await below can take a while (the disk may be slow, a dialog may be up), and the
// student can type, save or close the tab meanwhile. So after each one the code checks again
// that the doc is still open and still holds what it held before, and asks rather than
// replacing text that changed in the meantime.

import { confirm, invoke } from '../backend.js';
import { emit, state as app } from '../state.js';
import { showStatus } from '../shell/index.js';
import { becomeNotice, close, fileGone, isWithin, refreshDirty, refreshView, renderChrome, session, stampOf, stateOf, updateDoc } from './session.js';
import { fromDisk, replaceEndings, toDisk } from './line-endings.js';

// How long a disk check may take before the student is told and checks pause until it answers.
const CHECK_TIMEOUT_MS = 10000;

/**
 * Whether the file on disk is no longer the version `stamp` describes. File systems round
 * modification times differently, so within a millisecond counts as the same time; the size is
 * compared too, for file systems that keep whole seconds.
 */
const differs = (onDisk, stamp) => !stamp || Math.abs(onDisk.mtime - stamp.mtime) > 1 || onDisk.size !== stamp.size;

const isOpen = (doc) => session.docs.get(doc.path) === doc && doc.kind === 'text';

/** Saves `path` (the active file by default). Resolves true once it is on disk. */
export function save(path = session.active) {
  const doc = session.docs.get(path);
  if (doc?.kind !== 'text') return Promise.resolve(false);
  // Counted when asked for, so a disk check that overlaps a save knows to skip this file.
  doc.saves += 1;
  // One save at a time per file: a second Cmd+S waits for the first, then saves anything newer.
  const run = (doc.saving || Promise.resolve()).then(() => saveNow(doc));
  doc.saving = run;
  run.finally(() => doc.saving === run && (doc.saving = null));
  return run;
}

/** Shows the "changed on disk" banner for the version `stamp` (null when it could not be checked). */
function showChanged(doc, stamp) {
  doc.banner = { kind: 'changed', stamp };
  refreshDirty(doc);
  renderChrome();
}

/** What is on disk at the doc's path now: { mtime, size }, { missing: true } or { error }. */
async function statOne(doc) {
  try {
    const [onDisk] = await invoke('doc_stat', { paths: [doc.path] });
    return onDisk;
  } catch (e) {
    return { error: String(e) };
  }
}

async function saveNow(doc) {
  if (!doc.dirty) return true;
  // Each write takes the text as it is at that moment, which becomes the saved version.
  let written;
  const write = (expected) => {
    written = stateOf(doc);
    return invoke('doc_write', { rel: doc.path, text: toDisk(written), format: doc.format, expected });
  };
  try {
    let result = await write(doc.missing ? null : doc.stamp);
    if (result.status === 'changed') {
      if (!(await confirm(`${doc.path} changed on disk since you opened it. Overwrite it with your version?`, 'Overwrite'))) {
        const onDisk = await statOne(doc);
        if (onDisk.missing) await fileGone(doc);
        else showChanged(doc, onDisk.error ? null : stampOf(onDisk));
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
    doc.stamp = stampOf(result);
    doc.saved = written.doc;
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

/**
 * Replaces a doc's text with what is on disk now, keeping the cursor and scroll position: the
 * text it holds when this is called is the one given up. If the student types while the file
 * is being read, the disk version is offered in the banner instead.
 */
export async function reload(doc) {
  const before = stateOf(doc).doc;
  const saves = doc.saves;
  doc.reloading = true;
  let file;
  try {
    file = await invoke('doc_read', { rel: doc.path });
  } catch (e) {
    file = { kind: 'error', message: String(e) };
  } finally {
    doc.reloading = false;
  }
  if (!isOpen(doc)) return;
  // A save started meanwhile wrote the student's text; the next check compares with that.
  if (doc.saves !== saves) return;
  if (file.kind === 'missing') return fileGone(doc);
  if (!stateOf(doc).doc.eq(before)) return showChanged(doc, file.mtime == null ? null : stampOf(file));
  if (file.kind !== 'text') return becomeNotice(doc, file);
  const { text, endings } = fromDisk(file.text, file.format);
  const current = before.toString();
  updateDoc(doc, { changes: current === text ? [] : minimalChange(current, text), effects: replaceEndings(endings), userEvent: 'reload' });
  Object.assign(doc, { saved: stateOf(doc).doc, stamp: stampOf(file), format: file.format, missing: false, banner: null });
  refreshDirty(doc);
  renderChrome();
}

let checking = false;
let checkAgain = false;
/** A disk check that took too long and has not answered yet; no new one starts until it does. */
let stalled = null;
const TIMED_OUT = Symbol('timed out');

/**
 * Looks for open files that changed on disk: all of them, or those at or inside `paths` (as
 * `files:changed` gives them: files or folders, and '' for "anything may have changed"). Clean
 * ones are reloaded; one with unsaved edits gets a banner asking which version to keep.
 */
export async function checkDisk(paths) {
  if (!app.workspace || stalled) return;
  if (checking) return void (checkAgain = true);
  checking = true;
  try {
    const docs = [...session.docs.values()].filter(
      (doc) =>
        (doc.kind === 'text' || doc.kind === 'view') && !doc.saving && !doc.reloading && (!paths || paths.some((p) => p === '' || isWithin(doc.path, p))),
    );
    if (!docs.length) return;
    const asked = docs.map((doc) => ({ path: doc.path, saves: doc.saves }));
    const request = invoke('doc_stat', { paths: asked.map((a) => a.path) });
    let timer;
    const stats = await Promise.race([request, new Promise((resolve) => (timer = setTimeout(resolve, CHECK_TIMEOUT_MS, TIMED_OUT)))]).finally(() =>
      clearTimeout(timer),
    );
    if (stats === TIMED_OUT) {
      // A hung network mount: say so, and start checking again once it answers.
      showStatus('The disk is not answering, so changes to open files are not being picked up yet.', 8000);
      stalled = request;
      request
        .catch(() => {})
        .finally(() => {
          stalled = null;
          checkDisk();
        });
      return;
    }
    for (const [i, doc] of docs.entries()) {
      const onDisk = stats[i];
      // Skip a file renamed, closed, saved or reloading while its version was looked up.
      if (
        doc.path !== asked[i].path ||
        session.docs.get(doc.path) !== doc ||
        doc.kind === 'notice' ||
        doc.saving ||
        doc.reloading ||
        doc.saves !== asked[i].saves ||
        onDisk.error
      )
        continue;
      if (onDisk.missing) {
        if (!doc.missing) await fileGone(doc);
      } else if (doc.kind === 'view') {
        // A PDF or picture is never edited here, so a new version is simply shown.
        if (differs(onDisk, doc.stamp)) refreshView(doc, onDisk);
      } else if (doc.missing || differs(onDisk, doc.stamp)) {
        // This change is already on the banner.
        if (doc.banner?.kind === 'changed' && !(doc.banner.stamp && differs(onDisk, doc.banner.stamp))) continue;
        if (!doc.dirty) reload(doc);
        else {
          doc.missing = false;
          showChanged(doc, stampOf(onDisk));
        }
      }
    }
  } catch (e) {
    console.warn('Could not compare open files with the disk:', e);
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
  // The version on disk now is the one being overwritten, so saving no longer needs to ask.
  keepMine: async (doc) => {
    const onDisk = await statOne(doc);
    if (!isOpen(doc) || doc.banner?.kind !== 'changed') return;
    if (onDisk.missing) return fileGone(doc);
    doc.stamp = onDisk.error ? (doc.banner.stamp ?? doc.stamp) : stampOf(onDisk);
    doc.banner = null;
    renderChrome();
  },
  loadTheirs: (doc) => reload(doc),
  saveAgain: (doc) => save(doc.path),
  // The tab holds the only copy, so this asks like any other close with unsaved changes.
  discard: (doc) => close(doc.path),
  retry: (doc) => save(doc.path),
  dismiss: (doc) => {
    doc.banner = null;
    renderChrome();
  },
};
