// The editor: CodeMirror with one tab per open file. Other areas import from this file only.

import { toggleComment } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { h } from '../dom.js';
import { on } from '../state.js';
import { registerCommand, registerLeaveGuard, showStatus } from '../shell/index.js';
import { bannerActions, checkDisk, save } from './disk.js';
import { openGoToLine } from './go-to-line.js';
import { dropNotes, findNote, listNotes, moveToNote, openNoteAt, putNotes, refreshSpec, watchNotes } from './notes.js';
import { openReplace } from './search-panel.js';
import { flushTabs } from './restore.js';
import { addFileExtension } from './extensions.js';
import { applyTheme, attach, close, enterFolder, fileGone, isWithin, open, refreshFileExtensions, session, stateOf, updateDoc } from './session.js';
import { registerSelectionAction } from './selection-actions.js';
import { setThemeMode } from './theme.js';

export { open as openFile, movePaths, registerCustomEditor } from './session.js';
export { createCellState, refreshCellTheme } from './setup.js';
export { save, saveAll } from './disk.js';
export { registerSelectionAction };

// How often open files are compared with the disk while the window is in use. Changes normally
// arrive at once as `files:changed` from the folder watcher; this is the fallback for when the
// watcher could not start (a network drive) and for changes it passes over (the files area
// leaves out a file's changes for 2 seconds after the editor saved it). Changes made in
// Longhand's own terminal move no focus, so a focus event alone would miss them.
const DISK_CHECK_MS = 5000;

/**
 * The file shown in the editor, or null:
 * { path, dirty, cursorLine, selection: { fromLine, toLine, text } | null }. For a file a custom
 * editor shows (a notebook), cursorLine and selection are null and `place` says where the
 * student is in it ("cell 3 of 12"), or is null.
 */
export function activeFile() {
  const { view, active, docs } = session;
  const custom = active && docs.get(active).kind === 'custom' ? docs.get(active) : null;
  if (custom) return { path: active, dirty: custom.dirty, cursorLine: null, selection: null, place: custom.custom.place() };
  if (!view || !active || docs.get(active).kind !== 'text') return null;
  const { doc, selection } = view.state;
  const sel = selection.main;
  return {
    path: active,
    dirty: docs.get(active).dirty,
    cursorLine: doc.lineAt(sel.head).number,
    selection: sel.empty ? null : { fromLine: doc.lineAt(sel.from).number, toLine: doc.lineAt(sel.to).number, text: view.state.sliceDoc(sel.from, sel.to) },
  };
}

/**
 * After `path` (a file or folder) was deleted: closes the tabs at or inside it. A tab with
 * unsaved changes stays open and offers to save the file again, so nothing typed is lost.
 */
export async function closeFilesUnder(path) {
  for (const doc of [...session.docs.values()]) if (isWithin(doc.path, path)) await fileGone(doc);
}

/**
 * Pins notes to line ranges of `path`, replacing the notes `source` (a name such as 'review')
 * had there. Each note is { id, fromLine, toLine, body, kind?, head?, actions? }, where `body` is
 * a DOM node the editor shows beneath the lines when the note is opened; `head` and `actions`
 * (DOM nodes) go in the card's top row, after its lines and before Hide; `kind` ('bug',
 * 'fragile' or 'good') colours its bar in the gutter, which is otherwise neutral. Lines are 1-based and inclusive. Ranges
 * follow the student's edits. When a note's code is deleted it is hidden until undo or a paste
 * of that code brings it back, and removed (calling `onOrphaned(id, path)`) once its tab
 * closes; a note past the end of the file is removed at once, and every note is removed (and
 * reported) when another folder opens. Notes for a file that is not open appear when it opens.
 */
export function setNotes(source, path, notes, { onOrphaned } = {}) {
  putNotes(source, path, notes, onOrphaned);
}

/** Removes the notes `source` pinned to `path`, or to every file when `path` is omitted. */
export function clearNotes(source, path) {
  dropNotes(source, path);
}

/** Where `source`'s notes on `path` are now, after the student's edits: [{ id, fromLine, toLine }]. */
export const notesOn = (source, path) => listNotes(source, path);

/**
 * Opens `path` and the note `id` that `source` pinned there, scrolled into view. The cursor moves
 * to the note unless `keepCursor`. Resolves false if there is no such note.
 */
export async function showNote(source, path, id, { keepCursor = false } = {}) {
  const key = findNote(source, path, id);
  if (!key || !(await open(path))) return false;
  return openNoteAt(session.view, key, { keepCursor });
}

/** The text of `path` as the editor holds it now, unsaved edits included, or null when it is not open as text. */
export function openText(path) {
  const doc = session.docs.get(path);
  return doc?.kind === 'text' ? stateOf(doc).doc.toString() : null;
}

/**
 * Adds to every open file whatever CodeMirror extension `provide(path)` returns (nothing for a
 * file it has no business with). It is asked when a file opens or is renamed, and again for the
 * files `matches(path)` picks (all of them by default) whenever the returned function is called.
 */
export function registerFileExtension(provide) {
  addFileExtension(provide);
  return refreshFileExtensions;
}

/** The CodeMirror state of the text file open at `path`, unsaved edits included, or null. */
export function fileState(path) {
  const doc = session.docs.get(path);
  return doc?.kind === 'text' ? stateOf(doc) : null;
}

/** The editor view, when the text file at `path` is the one on screen; otherwise null. */
export const fileView = (path) => (session.active === path && session.docs.get(path)?.kind === 'text' ? session.view : null);

/** Applies a CodeMirror transaction to the text file open at `path`, on screen or not. */
export function updateFile(path, spec) {
  const doc = session.docs.get(path);
  if (doc?.kind === 'text') updateDoc(doc, spec);
}

/** Shows the registry's notes in an open file once they change. */
function refreshNotes(path) {
  const doc = session.docs.get(path);
  if (doc?.kind === 'text') updateDoc(doc, refreshSpec(path));
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

/** Runs `run(view)` on the file on screen, if it is a text file. */
const onView = (run) => () => {
  const doc = session.docs.get(session.active);
  if (doc?.kind !== 'text') return;
  session.view.focus();
  run(session.view);
};

const toNote = (dir) => onView((view) => moveToNote(view, dir) || showStatus('No notes in this file'));

function registerCommands() {
  registerCommand('save', () => save());
  registerCommand('close-tab', () => session.active && close(session.active));
  registerCommand('find', onView(openSearchPanel));
  registerCommand('replace', onView(openReplace));
  registerCommand('go-to-line', onView(openGoToLine));
  registerCommand('toggle-comment', onView(toggleComment));
  registerCommand('next-note', toNote(1));
  registerCommand('previous-note', toNote(-1));
}

export function mount(region) {
  const tabBar = h('div', { id: 'tabs' });
  const banner = h('div', { id: 'editor-banner', role: 'alert', hidden: true });
  const notice = h('div', { class: 'editor-notice', hidden: true });
  const host = h('div', { id: 'editor-host' }, notice);
  region.append(tabBar, banner, host);
  attach({ tabBar, banner, host, notice }, bannerActions);
  watchNotes(refreshNotes);
  registerCommands();

  // workspace:opened comes after the shell's leave guard has passed, so the old tabs can go.
  on('workspace:opened', (ws) => enterFolder(ws.path));
  on('editor:active', (path) => path && checkDisk([path]));
  on('files:changed', (paths) => checkDisk(paths));
  on('text-size:changed', () => session.view?.requestMeasure());
  on('theme:changed', (mode) => setThemeMode(mode) && applyTheme());
  window.addEventListener('focus', () => checkDisk());
  window.addEventListener('pagehide', flushTabs);
  setInterval(() => document.hasFocus() && checkDisk(), DISK_CHECK_MS);
  registerLeaveGuard(unsavedWork);
  // The interface tests and previews run against the mock backend and drive the tutor hooks
  // directly, since no tutor feature uses them yet. The real app never sets __MOCK__.
  if (window.__MOCK__) window.__editor = { setNotes, clearNotes, notesOn, showNote, registerSelectionAction };
}
