// The file tree: which folders are open, which row has the keyboard focus, and drawing the
// visible rows. Folders list folders first, then files; very large folders show a page of
// entries at a time.

import { emptyState, h } from '../dom.js';
import { cachedListing, loadListing } from './listing.js';
import { rememberExpanded } from './memory.js';
import { treeView } from './panel.js';

/** Entries drawn per folder before a "Show more" row. */
const PAGE = 500;
const INDENT_PX = 12;
const BASE_INDENT_PX = 8;

const expanded = new Set();
/** folder -> how many of its entries are drawn, when more than PAGE */
const shown = new Map();
/** The visible rows, in order: { key, depth, entry, quiet } or { key, depth, more: folder, remaining }. */
let rows = [];
let focusKey = null;
let activePath = null;
let painting = true;
let onEmpty = () => {};

export const parentOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const moreKey = (dir) => '\0more:' + dir;

/** Sets what the empty folder's "New File" button does (actions.js depends on this file). */
export const setEmptyAction = (action) => (onEmpty = action);

/** Restores the expanded folders remembered for a newly opened folder. */
export function resetTree(remembered) {
  expanded.clear();
  for (const path of remembered) expanded.add(path);
  shown.clear();
  rows = [];
  focusKey = null;
  activePath = null;
}

export const isExpanded = (path) => expanded.has(path);

export function setExpanded(path, open) {
  if (open === expanded.has(path)) return;
  if (open) expanded.add(path);
  else expanded.delete(path);
  rememberExpanded(expanded);
}

/** Expands every folder above `path`. */
export function expandTo(path) {
  const parts = path.split('/').slice(0, -1);
  parts.forEach((_, i) => setExpanded(parts.slice(0, i + 1).join('/'), true));
}

/** Points expanded folders at their new place after a rename, or forgets them when `to` is null. */
export function moveExpanded(from, to) {
  for (const path of [...expanded]) {
    if (path !== from && !path.startsWith(from + '/')) continue;
    expanded.delete(path);
    if (to != null) expanded.add(to + path.slice(from.length));
  }
  rememberExpanded(expanded);
}

/** Draws at least enough of `dir` to include `path`. */
function showEntry(dir, path) {
  const index = (cachedListing(dir) || []).findIndex((e) => e.path === path);
  if (index >= (shown.get(dir) || PAGE)) shown.set(dir, Math.ceil((index + 1) / PAGE) * PAGE);
}

export function showMore(dir) {
  shown.set(dir, (shown.get(dir) || PAGE) + PAGE);
}

async function loadVisible(dir = '') {
  const entries = await loadListing(dir);
  await Promise.all(entries.filter((e) => e.dir && expanded.has(e.path)).map((e) => loadVisible(e.path)));
}

function buildRows() {
  const out = [];
  const walk = (dir, depth, quiet) => {
    const entries = cachedListing(dir) || [];
    const limit = shown.get(dir) || PAGE;
    for (const entry of entries.slice(0, limit)) {
      const rowQuiet = quiet || !!entry.ignored;
      out.push({ key: entry.path, depth, entry, quiet: rowQuiet });
      if (entry.dir && expanded.has(entry.path)) walk(entry.path, depth + 1, rowQuiet);
    }
    if (entries.length > limit) out.push({ key: moreKey(dir), depth, more: dir, remaining: entries.length - limit });
  };
  walk('', 0, false);
  return out;
}

export const indent = (depth) => BASE_INDENT_PX + depth * INDENT_PX + 'px';

function drawRow(row, i) {
  const attrs = { id: `tree-row-${i}`, 'data-key': row.key, role: 'treeitem', 'aria-level': row.depth + 1 };
  if (row.more) {
    const label = `Show ${Math.min(row.remaining, PAGE).toLocaleString()} more of ${row.remaining.toLocaleString()}`;
    const node = h('div', { ...attrs, class: 'tree-more list-row' }, h('span', { class: 'twist' }), h('span', { class: 'label' }, label));
    node.style.paddingLeft = indent(row.depth);
    return node;
  }
  const { entry } = row;
  const open = entry.dir && expanded.has(entry.path);
  const classes = ['node', 'list-row', entry.dir && 'dir', row.quiet && 'quiet', entry.path === activePath && 'active'];
  const node = h(
    'div',
    {
      ...attrs,
      class: classes.filter(Boolean).join(' '),
      'data-path': entry.path,
      'aria-expanded': entry.dir ? String(open) : null,
      'aria-selected': String(entry.path === activePath),
      title: entry.path,
    },
    h('span', { class: 'twist' }, entry.dir ? (open ? '▾' : '▸') : ''),
    h('span', { class: 'label' }, entry.name),
  );
  node.style.paddingLeft = indent(row.depth);
  return node;
}

function paint() {
  if (!painting) return;
  rows = buildRows();
  if (!rows.some((r) => r.key === focusKey)) focusKey = rows.find((r) => r.key === activePath)?.key ?? rows[0]?.key ?? null;
  if (!rows.length) {
    const create = h('button', { class: 'tree-empty-action', onclick: () => onEmpty() }, 'New File');
    treeView.replaceChildren(h('div', { class: 'tree-empty' }, emptyState('This folder is empty.'), create));
    treeView.removeAttribute('aria-activedescendant');
    return;
  }
  treeView.replaceChildren(...rows.map(drawRow));
  markFocus();
}

let running = null;
let dirty = false;

/** Loads whatever the open folders need and redraws. Calls made while one runs share it. */
export function renderTree() {
  dirty = true;
  running ||= (async () => {
    while (dirty) {
      dirty = false;
      await loadVisible();
    }
    running = null;
    paint();
  })();
  return running;
}

/** Stops redrawing while the naming field is in the tree, so a change on disk cannot remove it. */
export function holdPainting(hold) {
  painting = !hold;
  if (!hold) paint();
}

// ---- focus and the active file ----

export const visibleRows = () => rows;
export const focusedRow = () => rows.find((r) => r.key === focusKey) || null;
export const rowElement = (key) => [...treeView.children].find((n) => n.dataset.key === key) || null;

function markFocus(scroll = false) {
  for (const node of treeView.querySelectorAll('.focused')) node.classList.remove('focused');
  const node = focusKey != null && rowElement(focusKey);
  if (!node) return treeView.removeAttribute('aria-activedescendant');
  node.classList.add('focused');
  treeView.setAttribute('aria-activedescendant', node.id);
  if (scroll) node.scrollIntoView({ block: 'nearest' });
}

/** Moves the keyboard focus to the row with `key`. */
export function focusRow(key) {
  focusKey = key;
  markFocus(true);
}

/** Marks the file shown in the editor, expanding folders and paging so its row is visible. */
export async function reveal(path) {
  activePath = path;
  if (!path) return paint();
  expandTo(path);
  await renderTree();
  showEntry(parentOf(path), path);
  focusKey = path;
  paint();
  markFocus(true);
}
