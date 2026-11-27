// The editor: CodeMirror with one tab per open file. Other areas import from this file only.

import { h } from '../dom.js';
import { on } from '../state.js';
import { registerCommand, registerLeaveGuard } from '../shell/index.js';
import { reloadChangedFiles, save } from './disk.js';
import { attach, close, isWithin, reset, session } from './session.js';

export { open as openFile, movePaths } from './session.js';
export { save, saveAll } from './disk.js';

/**
 * The file shown in the editor, or null:
 * { path, dirty, cursorLine, selection: { fromLine, toLine, text } | null }
 */
export function activeFile() {
  const { view, active, docs } = session;
  if (!view || !active) return null;
  const { doc, selection } = view.state;
  const sel = selection.main;
  return {
    path: active,
    dirty: docs.get(active).dirty,
    cursorLine: doc.lineAt(sel.head).number,
    selection: sel.empty ? null : { fromLine: doc.lineAt(sel.from).number, toLine: doc.lineAt(sel.to).number, text: view.state.sliceDoc(sel.from, sel.to) },
  };
}

/** Closes open tabs at or inside `path`, without asking, after it was deleted. */
export async function closeFilesUnder(path) {
  for (const open of [...session.docs.keys()]) if (isWithin(open, path)) await close(open, true);
}

/** What quitting or switching folder would lose, for the shell's leave guard. */
function unsavedWork(reason) {
  const dirty = [...session.docs.values()].filter((doc) => doc.dirty).length;
  if (!dirty) return null;
  const files = `${dirty} ${dirty === 1 ? 'file has' : 'files have'} unsaved changes.`;
  return reason === 'quit'
    ? { message: `${files} Quit without saving?`, action: 'Quit Without Saving' }
    : { message: `${files} Open another folder without saving?`, action: 'Discard Changes' };
}

export function mount(region) {
  const tabBar = h('div', { id: 'tabs' });
  const host = h('div', { id: 'editor-host' });
  region.append(tabBar, host);
  attach(tabBar, host);

  registerCommand('save', () => save());
  registerCommand('close-tab', () => session.active && close(session.active));
  on('workspace:opened', reset);
  on('text-size:changed', () => session.view?.requestMeasure());
  window.addEventListener('focus', reloadChangedFiles);
  registerLeaveGuard(unsavedWork);
}
