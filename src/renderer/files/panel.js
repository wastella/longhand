// The files sidebar's fixed parts: its header, and the two views it switches between
// (the tree and find in files).

import { h, paneHead, spacer } from '../dom.js';

const title = h('span', { id: 'files-title' }, 'Files');
export const findToggle = h('button', { id: 'toggle-search', class: 'ghost', title: 'Find in files (⇧⌘F)' }, 'Find');
export const newFileButton = h('button', { id: 'new-file', class: 'ghost', title: 'New file (⌘N)', 'aria-label': 'New file' }, '+');
export const header = paneHead(title, spacer(), findToggle, newFileButton);

export const treeView = h('div', { id: 'tree', tabindex: '0', role: 'tree', 'aria-label': 'Files' });

const toggle = (id, label, title) => h('button', { id, class: 'ghost search-toggle', title, 'aria-label': title, 'aria-pressed': 'false' }, label);
export const searchInput = h('input', {
  id: 'search-input',
  class: 'text-input',
  type: 'search',
  placeholder: 'Search this folder',
  spellcheck: 'false',
  'aria-label': 'Search this folder',
});
export const caseToggle = toggle('search-case', 'Aa', 'Match case');
export const wordToggle = toggle('search-word', 'ab', 'Whole word');
export const searchSummary = h('div', { id: 'search-summary', 'aria-live': 'polite' });
export const searchResults = h('div', { id: 'search-results', tabindex: '-1', role: 'listbox', 'aria-label': 'Search results' });
export const searchView = h(
  'div',
  { id: 'search', hidden: true },
  h('div', { class: 'search-bar' }, searchInput, caseToggle, wordToggle),
  searchSummary,
  searchResults,
);

/** Shows the 'tree' or the 'search' view. */
export function showView(which) {
  treeView.hidden = which !== 'tree';
  searchView.hidden = which !== 'search';
  title.textContent = which === 'search' ? 'Find in files' : 'Files';
  findToggle.textContent = which === 'search' ? 'Files' : 'Find';
}
