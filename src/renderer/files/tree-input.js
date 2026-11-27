// Pointer and keyboard input on the file tree. Focus stays on the tree itself and moves between
// rows (aria-activedescendant), so redrawing the rows never loses it.

import { openFile } from '../editor/index.js';
import { moveToTrash, rename, showEntryMenu } from './actions.js';
import { treeView } from './panel.js';
import { focusRow, focusedRow, isExpanded, parentOf, renderTree, rowElement, setExpanded, showMore, visibleRows } from './tree.js';

const TYPE_AHEAD_RESET_MS = 800;
let typed = '';
let typedAt = 0;

function activate(row) {
  if (row.more) {
    showMore(row.more);
    return renderTree();
  }
  const { path, dir } = row.entry;
  if (!dir) return openFile(path);
  setExpanded(path, !isExpanded(path));
  renderTree();
}

function moveBy(step) {
  const rows = visibleRows();
  const at = rows.indexOf(focusedRow());
  const next = rows[Math.max(0, Math.min(rows.length - 1, at + step))];
  if (next) focusRow(next.key);
}

function right(row) {
  if (!row.entry?.dir) return;
  if (!isExpanded(row.entry.path)) return activate(row);
  const rows = visibleRows();
  const child = rows[rows.indexOf(row) + 1];
  if (child && child.depth > row.depth) focusRow(child.key);
}

function left(row) {
  if (row.entry?.dir && isExpanded(row.entry.path)) return activate(row);
  // A "Show more" row's parent is the folder it pages through.
  const parent = row.more ?? parentOf(row.key);
  if (parent) focusRow(parent);
}

/** Jumps to the next row whose name starts with what was just typed. */
function typeAhead(key) {
  const now = Date.now();
  typed = now - typedAt > TYPE_AHEAD_RESET_MS ? key : typed + key;
  typedAt = now;
  const rows = visibleRows();
  const at = Math.max(0, rows.indexOf(focusedRow()));
  // A fresh single letter moves on to the next match; a longer prefix may stay put.
  const start = typed.length === 1 ? at + 1 : at;
  const prefix = typed.toLowerCase();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[(start + i) % rows.length];
    if (row.entry?.name.toLowerCase().startsWith(prefix)) return focusRow(row.key);
  }
}

function menuUnder(row) {
  const rect = rowElement(row.key).getBoundingClientRect();
  showEntryMenu({ x: rect.left + 24, y: rect.bottom }, row.entry || null, { fromKeyboard: true });
}

function onKey(e) {
  const row = focusedRow();
  if (!row) return;
  const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
  let handled = true;
  if (e.key === 'ArrowDown' && plain) moveBy(1);
  else if (e.key === 'ArrowUp' && plain) moveBy(-1);
  else if (e.key === 'Home') moveBy(-Infinity);
  else if (e.key === 'End') moveBy(Infinity);
  else if (e.key === 'ArrowRight' && plain) right(row);
  else if (e.key === 'ArrowLeft' && plain) left(row);
  else if (e.key === 'Enter' && plain) activate(row);
  else if (e.key === 'F2' && row.entry) rename(row.entry);
  else if (((e.key === 'Backspace' && e.metaKey) || e.key === 'Delete') && row.entry) moveToTrash(row.entry);
  else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) menuUnder(row);
  else if (e.key.length === 1 && e.key !== ' ' && plain) typeAhead(e.key);
  else handled = false;
  if (handled) e.preventDefault();
}

function rowFrom(event) {
  const key = event.target.closest('[data-key]')?.dataset.key;
  return visibleRows().find((r) => r.key === key) || null;
}

export function setupTreeInput() {
  treeView.addEventListener('keydown', onKey);
  treeView.addEventListener('click', (e) => {
    const row = rowFrom(e);
    if (!row) return;
    focusRow(row.key);
    activate(row);
  });
  treeView.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.naming-row')) return;
    e.preventDefault();
    const row = rowFrom(e);
    if (row) focusRow(row.key);
    showEntryMenu({ x: e.clientX, y: e.clientY }, row?.entry || null);
  });
}
