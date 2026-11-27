// The files sidebar's fixed parts: its header, and the two views it switches between
// (the tree and find in files).

import { h, paneHead, spacer } from '../dom.js';

const title = h('span', { id: 'files-title' }, 'Files');
export const findToggle = h('button', { id: 'toggle-search', class: 'ghost', title: 'Find in files (⇧⌘F)' }, 'Find');
export const newFileButton = h('button', { id: 'new-file', class: 'ghost', title: 'New file (⌘N)' }, '+');
export const header = paneHead(title, spacer(), findToggle, newFileButton);

export const treeView = h('div', { id: 'tree' });

export const searchInput = h('input', { id: 'search-input', class: 'text-input', type: 'search', placeholder: 'Search this folder', spellcheck: 'false' });
export const searchResults = h('div', { id: 'search-results' });
export const searchView = h('div', { id: 'search', hidden: true }, searchInput, searchResults);

/** Shows the 'tree' or the 'search' view. */
export function showView(which) {
  treeView.hidden = which !== 'tree';
  searchView.hidden = which !== 'search';
  title.textContent = which === 'search' ? 'Find in files' : 'Files';
  findToggle.textContent = which === 'search' ? 'Files' : 'Find';
}
