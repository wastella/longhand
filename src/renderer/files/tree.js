// The file tree. Folders open in place; the backend lists folders first, then files.

import { invoke } from '../backend.js';
import { h } from '../dom.js';
import { openFile } from '../editor/index.js';
import { treeView } from './panel.js';

const expanded = new Set();
let activePath = null;

export const collapseAll = () => expanded.clear();

/** Expands every folder above `path`. */
export function expandTo(path) {
  const parts = path.split('/').slice(0, -1);
  parts.forEach((_, i) => expanded.add(parts.slice(0, i + 1).join('/')));
}

function row(entry, depth) {
  const open = expanded.has(entry.path);
  const node = h(
    'div',
    {
      class: 'node list-row' + (entry.dir ? ' dir' : ''),
      'data-path': entry.path,
      onclick: () => {
        if (!entry.dir) return openFile(entry.path);
        if (!expanded.delete(entry.path)) expanded.add(entry.path);
        renderTree();
      },
    },
    h('span', { class: 'twist' }, entry.dir ? (open ? '▾' : '▸') : ''),
    h('span', { class: 'label' }, entry.name),
  );
  node.style.paddingLeft = 8 + depth * 12 + 'px';
  return node;
}

export async function renderTree() {
  const rows = document.createDocumentFragment();
  const walk = async (rel, depth) => {
    let entries = [];
    try {
      entries = await invoke('fs_list', { rel });
    } catch {
      // A folder that vanished or cannot be read simply shows as empty.
    }
    for (const entry of entries) {
      rows.append(row(entry, depth));
      if (entry.dir && expanded.has(entry.path)) await walk(entry.path, depth + 1);
    }
  };
  await walk('', 0);
  treeView.replaceChildren(rows);
  highlight(activePath);
}

/** Marks the row of the file open in the editor. */
export function highlight(path) {
  activePath = path;
  for (const node of treeView.querySelectorAll('.node')) node.classList.toggle('active', node.dataset.path === path);
}
