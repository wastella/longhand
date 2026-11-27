// The open files and the single CodeMirror view that shows the active one.
//
// Each open file is a doc: { path, kind, dirty, banner, ... }. A text doc ('text') also has its
// CodeMirror `state`, the text last read or written (`saved`), the version on disk that text
// came from (`stamp`: { mtime, size }), the file's `format`, `missing` once it has been deleted
// underneath the editor, and `saves`, counting the saves started. A file the editor will
// not open (binary, too large) is a 'notice' doc with the reason in `notice`. Insertion order of
// `session.docs` is tab order.
//
// Other areas follow the text files through editor:opened, editor:changed, editor:renamed and
// editor:closed (see state.js).

import { EditorView } from '@codemirror/view';
import { confirm, invoke } from '../backend.js';
import { emit, state as app } from '../state.js';
import { notify, showStatus } from '../shell/index.js';
import { createEditorState, languageSlot } from './setup.js';
import { fileExtensionSlot, fileExtensions } from './extensions.js';
import { languageSupport } from './languages.js';
import { currentThemeMode, isStale, themeMode } from './theme.js';
import { goTo } from './go-to-line.js';
import { forgetAllNotes, moveNotes, releaseDetached, syncNotes } from './notes.js';
import { fromDisk } from './line-endings.js';
import { renderTabBar, wireTabBar } from './tab-bar.js';
import { renderBanner, renderFileNotice } from './notice.js';
import { flushTabs, recallTabs, rememberTabs } from './restore.js';

export const session = {
  docs: new Map(),
  /** The path shown in the editor, or null. */
  active: null,
  /** Created when the first file opens, then reused for every file. */
  view: null,
  /** Bumped when the folder changes, so reads started for the old folder are dropped. */
  generation: 0,
  /** True while reopening a folder's files, so the half-restored list is not remembered. */
  restoring: false,
};

let ui;
let bannerActions;
const loading = new Map();

/** `elements`: { tabBar, banner, host, notice }; `actions`: the banner's handlers, given the doc. */
export function attach(elements, actions) {
  ui = elements;
  bannerActions = actions;
  wireTabBar(ui.tabBar, { onSelect: activate });
}

export const isWithin = (path, prefix) => path === prefix || path.startsWith(prefix + '/');

/** The version of a file a backend result describes: { mtime, size }. */
export const stampOf = (file) => ({ mtime: file.mtime, size: file.size });

const isShown = (doc) => doc.path === session.active && doc.kind === 'text' && session.view;

/** A doc's current CodeMirror state: the view's while the doc is on screen. */
export const stateOf = (doc) => (isShown(doc) ? session.view.state : doc.state);

/** Redraws the tabs and the banner of the file on screen. */
export function renderChrome() {
  renderTabBar(ui.tabBar, session, { onSelect: activate, onClose: (path) => close(path) });
  const doc = session.docs.get(session.active);
  const bind = (run) => () => run(doc);
  renderBanner(ui.banner, doc, Object.fromEntries(Object.entries(bannerActions).map(([name, run]) => [name, bind(run)])));
}

/** Recomputes whether a doc differs from the file on disk. */
export function refreshDirty(doc) {
  const dirty = doc.kind === 'text' && (doc.missing || !stateOf(doc).doc.eq(doc.saved));
  if (dirty === doc.dirty) return;
  doc.dirty = dirty;
  renderChrome();
}

/** Applies a transaction to a doc, whether or not it is the one on screen. */
export function updateDoc(doc, spec) {
  if (isShown(doc)) return session.view.dispatch(spec);
  const before = doc.state;
  doc.state = before.update(spec).state;
  syncNotes(doc.path, before, doc.state);
  refreshDirty(doc);
  if (!before.doc.eq(doc.state.doc)) emit('editor:changed', doc.path);
}

function onViewUpdate(doc, update) {
  syncNotes(doc.path, update.startState, update.state);
  if (update.docChanged) {
    refreshDirty(doc);
    emit('editor:changed', doc.path);
  }
  if ((update.docChanged || update.selectionSet) && isShown(doc)) {
    publishCursor();
    remember();
  }
}

function publishCursor() {
  const { view, active } = session;
  if (!view || !active || session.docs.get(active).kind !== 'text') return emit('editor:cursor', null);
  const { doc, selection } = view.state;
  const sel = selection.main;
  const line = doc.lineAt(sel.head);
  emit('editor:cursor', {
    path: active,
    line: line.number,
    col: sel.head - line.from + 1,
    selection: sel.empty ? null : { fromLine: doc.lineAt(sel.from).number, toLine: doc.lineAt(sel.to).number },
  });
}

function remember() {
  if (session.restoring || !app.workspace) return;
  const files = [...session.docs.values()].filter((doc) => doc.kind === 'text').map((doc) => ({ path: doc.path, cursor: stateOf(doc).selection.main.head }));
  rememberTabs(app.workspace.path, files, session.active);
}

function textDoc(path, file, cursor) {
  const doc = { path, kind: 'text', stamp: stampOf(file), format: file.format, saves: 0, dirty: false, missing: false, banner: null, scroll: null };
  const { text, endings } = fromDisk(file.text, file.format);
  let state = createEditorState(doc, text, { endings, onUpdate: (update) => onViewUpdate(doc, update) });
  if (cursor) state = state.update({ selection: { anchor: Math.min(cursor, state.doc.length) } }).state;
  doc.state = state;
  doc.saved = state.doc;
  syncNotes(path, null, state);
  return doc;
}

const noticeDoc = (path, notice) => ({ path, kind: 'notice', notice, dirty: false, banner: null });

/** Turns an open doc into a notice in place, when its file stopped being readable text. */
export function becomeNotice(doc, notice) {
  if (doc.kind === 'text') {
    releaseDetached(doc.path, stateOf(doc));
    emit('editor:closed', doc.path);
  }
  Object.assign(doc, noticeDoc(doc.path, notice));
  if (doc.path === session.active) activate(doc.path);
}

async function read(path, cursor) {
  const generation = session.generation;
  let file;
  try {
    file = await invoke('doc_read', { rel: path });
  } catch (e) {
    file = { kind: 'error', message: String(e) };
  }
  if (generation !== session.generation || file.kind === 'missing') return null;
  if (!session.docs.has(path)) {
    session.docs.set(path, file.kind === 'text' ? textDoc(path, file, cursor) : noticeDoc(path, file));
    if (file.kind === 'text') emit('editor:opened', path);
  }
  return session.docs.get(path);
}

/** The doc for `path`, reading the file into a new tab if it is not open; null if it does not exist. */
function load(path, cursor) {
  if (session.docs.has(path)) return Promise.resolve(session.docs.get(path));
  if (!loading.has(path))
    loading.set(
      path,
      read(path, cursor).finally(() => loading.delete(path)),
    );
  return loading.get(path);
}

/** Keeps the view's latest state and scroll position in the active doc before the view switches. */
function stashActive() {
  const doc = session.docs.get(session.active);
  if (!doc || !isShown(doc)) return;
  doc.state = session.view.state;
  doc.scroll = session.view.scrollSnapshot();
}

export function activate(path) {
  stashActive();
  const doc = session.docs.get(path);
  session.active = path;
  ui.notice.hidden = doc.kind === 'text';
  if (doc.kind === 'text') {
    if (!session.view) session.view = new EditorView({ state: doc.state, parent: ui.host });
    session.view.dom.hidden = false;
    session.view.setState(doc.state);
    if (isStale(doc.state)) session.view.dispatch({ effects: themeMode.reconfigure(currentThemeMode()) });
    session.view.dispatch({ effects: doc.scroll ?? EditorView.scrollIntoView(doc.state.selection.main.head, { y: 'center' }) });
    // At once, so whatever opens next (quick open, a dialog) gives the focus back to the code.
    // A key that opens a file (Enter in the tree, quick open or a name field) must call
    // preventDefault, or it would carry on into the file as a stray line break.
    session.view.focus();
  } else {
    if (session.view) session.view.dom.hidden = true;
    renderFileNotice(ui.notice, doc, { onClose: () => close(doc.path) });
  }
  renderChrome();
  emit('editor:active', path);
  publishCursor();
  remember();
}

function showNothing() {
  session.active = null;
  if (session.view) session.view.dom.hidden = true;
  ui.notice.hidden = true;
  renderChrome();
  emit('editor:active', null);
  publishCursor();
  remember();
}

/** Opens `path` in a tab (or switches to it), optionally with the cursor on `line` (and `column`). Resolves false if it could not. */
export async function open(path, line, column) {
  const doc = await load(path);
  if (!doc) {
    showStatus(`${path} no longer exists`);
    return false;
  }
  activate(path);
  if (line && doc.kind === 'text') goTo(session.view, line, column);
  return true;
}

/** Closes a tab, asking first if it has unsaved changes (unless `force`). Resolves false if it stayed open. */
export async function close(path, force = false) {
  const doc = session.docs.get(path);
  if (!doc) return false;
  if (doc.dirty && !force && !(await confirm(`${doc.path} has unsaved changes. Close it without saving?`, 'Close Without Saving'))) return false;
  // The tab may have been renamed or closed while the question was up.
  if (session.docs.get(doc.path) !== doc) return false;
  const order = [...session.docs.keys()];
  const i = order.indexOf(doc.path);
  // Undo goes with the tab, so notes whose code was deleted cannot come back any more.
  if (doc.kind === 'text') releaseDetached(doc.path, stateOf(doc));
  session.docs.delete(doc.path);
  if (doc.kind === 'text') emit('editor:closed', doc.path);
  if (session.active !== doc.path) {
    renderChrome();
    remember();
  } else {
    // The tab to the right takes its place, or the one to the left when it was the last.
    session.active = null;
    const next = order[i + 1] || order[i - 1];
    if (next) activate(next);
    else showNothing();
  }
  return true;
}

/**
 * The file behind `doc` is gone. A tab with nothing unsaved closes; one with unsaved changes
 * stays open, counts as unsaved, and offers to write the file back.
 */
export async function fileGone(doc) {
  if (!doc.dirty) {
    await close(doc.path, true);
    return notify({ message: `${doc.path} was deleted, so its tab was closed` });
  }
  doc.missing = true;
  doc.banner = { kind: 'deleted' };
  refreshDirty(doc);
  renderChrome();
}

/** Points open tabs at their new paths after a file or folder was renamed from `from` to `to`. */
export function movePaths(from, to) {
  stashActive();
  const renamed = [];
  const moved = [...session.docs].map(([path, doc]) => {
    if (!isWithin(path, from)) return [path, doc];
    doc.path = to + path.slice(from.length);
    if (doc.kind === 'text') renamed.push({ from: path, to: doc.path });
    return [doc.path, doc];
  });
  moveNotes(from, to);
  const active = session.active && isWithin(session.active, from) ? to + session.active.slice(from.length) : session.active;
  session.docs.clear();
  for (const [path, doc] of moved) session.docs.set(path, doc);
  session.active = null;
  for (const change of renamed) {
    emit('editor:renamed', change);
    // The new name may mean another language; undo history and the cursor survive.
    const doc = session.docs.get(change.to);
    const effects = [languageSlot.reconfigure(languageSupport(doc.path, doc.state.doc.toString())), fileExtensionSlot.reconfigure(fileExtensions(doc.path))];
    doc.state = doc.state.update({ effects }).state;
  }
  if (active) activate(active);
  else renderChrome();
}

/** Forgets every open file and note, for a newly opened folder. */
function reset() {
  flushTabs();
  session.generation++;
  session.docs.clear();
  forgetAllNotes();
  showNothing();
}

/** Starts afresh in a newly opened folder, reopening the files that were open there last time. */
export async function enterFolder(folder) {
  session.restoring = true;
  try {
    reset();
    const saved = recallTabs(folder);
    if (!saved) return;
    for (const { path, cursor } of saved.files) await load(path, cursor);
    const active = session.docs.has(saved.active) ? saved.active : [...session.docs.keys()].pop();
    if (active) activate(active);
  } finally {
    session.restoring = false;
  }
}

/** Works out again what other areas add to the open files (extensions.js): all of them, or those `matches(path)` picks. */
export function refreshFileExtensions(matches = () => true) {
  for (const doc of session.docs.values())
    if (doc.kind === 'text' && matches(doc.path)) updateDoc(doc, { effects: fileExtensionSlot.reconfigure(fileExtensions(doc.path)) });
}

/** Reconfigures the file on screen for a new colour theme; the others catch up when shown. */
export function applyTheme() {
  if (session.view && isStale(session.view.state)) session.view.dispatch({ effects: themeMode.reconfigure(currentThemeMode()) });
}
