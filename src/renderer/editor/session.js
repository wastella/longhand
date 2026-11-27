// The open files and the single CodeMirror view that shows the active one.

import { EditorView } from '@codemirror/view';
import { confirm, invoke } from '../backend.js';
import { emit } from '../state.js';
import { showStatus } from '../shell/index.js';
import { createEditorState } from './setup.js';
import { renderTabBar } from './tab-bar.js';

export const session = {
  /** path -> { state, dirty, mtime }; insertion order is tab order. */
  docs: new Map(),
  /** The path shown in the view, or null. */
  active: null,
  /** Created when the first file opens, then reused for every file. */
  view: null,
};

let tabBar;
let host;

export function attach(tabBarElement, hostElement) {
  tabBar = tabBarElement;
  host = hostElement;
}

export const isWithin = (path, prefix) => path === prefix || path.startsWith(prefix + '/');

export function docState(path, text) {
  return createEditorState(path, text, { onEdit: () => setDirty(path, true), onCursor: publishCursor });
}

export function renderTabs() {
  renderTabBar(tabBar, session, { onSelect: activate, onClose: (path) => close(path) });
}

export function setDirty(path, dirty) {
  const doc = session.docs.get(path);
  if (!doc || doc.dirty === dirty) return;
  doc.dirty = dirty;
  renderTabs();
}

function publishCursor() {
  const { view, active } = session;
  if (!view || !active) return emit('editor:cursor', null);
  const doc = view.state.doc;
  const sel = view.state.selection.main;
  const line = doc.lineAt(sel.head);
  emit('editor:cursor', {
    path: active,
    line: line.number,
    col: sel.head - line.from + 1,
    selection: sel.empty ? null : { fromLine: doc.lineAt(sel.from).number, toLine: doc.lineAt(sel.to).number },
  });
}

/** Keeps the view's latest edits in the active doc before the view switches to another. */
function stashActive() {
  const { view, active, docs } = session;
  if (active && view && docs.has(active)) docs.get(active).state = view.state;
}

export function activate(path) {
  stashActive();
  session.active = path;
  const { state } = session.docs.get(path);
  if (!session.view) session.view = new EditorView({ state, parent: host });
  else session.view.setState(state);
  session.view.dom.hidden = false;
  session.view.focus();
  renderTabs();
  emit('editor:active', path);
  publishCursor();
}

function showNothing() {
  session.active = null;
  if (session.view) session.view.dom.hidden = true;
  emit('editor:active', null);
  publishCursor();
}

/** Opens `path` in a tab (or switches to it) and optionally puts the cursor on `line`. */
export async function open(path, line) {
  if (!session.docs.has(path)) {
    let file;
    try {
      file = await invoke('fs_read', { rel: path });
    } catch (e) {
      return showStatus(String(e));
    }
    if (file.tooLarge || file.binary) return showStatus(file.binary ? `${path} is a binary file` : `${path} is too large to open`);
    session.docs.set(path, { state: docState(path, file.text), dirty: false, mtime: file.mtime });
  }
  activate(path);
  if (line) {
    const doc = session.view.state.doc;
    const at = doc.line(Math.min(line, doc.lines));
    session.view.dispatch({ selection: { anchor: at.from }, effects: EditorView.scrollIntoView(at.from, { y: 'center' }) });
  }
}

/** Closes a tab, asking first if it has unsaved changes (unless `force`). */
export async function close(path, force = false) {
  const doc = session.docs.get(path);
  if (!doc) return;
  if (doc.dirty && !force && !(await confirm(`${path} has unsaved changes. Close it without saving?`, 'Close Without Saving'))) return;
  const order = [...session.docs.keys()];
  const i = order.indexOf(path);
  session.docs.delete(path);
  if (session.active === path) {
    const next = order[i + 1] || order[i - 1];
    if (next) activate(next);
    else showNothing();
  }
  renderTabs();
}

/** Points open tabs at their new paths after a file or folder was renamed from `from` to `to`. */
export function movePaths(from, to) {
  stashActive();
  const moved = [...session.docs].map(([path, doc]) => {
    const next = isWithin(path, from) ? to + path.slice(from.length) : path;
    return [next, next === path ? doc : { ...doc, state: docState(next, doc.state.doc.toString()) }];
  });
  const active = session.active && (isWithin(session.active, from) ? to + session.active.slice(from.length) : session.active);
  session.docs.clear();
  for (const [path, doc] of moved) session.docs.set(path, doc);
  session.active = null;
  if (active) activate(active);
}

/** Forgets every open file, for a newly opened folder. */
export function reset() {
  session.docs.clear();
  renderTabs();
  showNothing();
}
