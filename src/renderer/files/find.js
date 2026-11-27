// Find in files: a case-insensitive search across the folder, with results that open at the line.

import { invoke } from '../backend.js';
import { emptyState, h } from '../dom.js';
import { state } from '../state.js';
import { activeFile, openFile } from '../editor/index.js';
import { showPanel } from '../shell/index.js';
import { searchInput, searchResults, showView } from './panel.js';

const TYPING_DELAY_MS = 200;
let latestQuery = 0;

/** Opens the search view, starting from the editor's selection when it is a short single line. */
export function openFind() {
  if (!state.workspace) return;
  showPanel('files');
  showView('search');
  const selected = activeFile()?.selection?.text;
  if (selected && !selected.includes('\n') && selected.length < 80) searchInput.value = selected;
  searchInput.focus();
  searchInput.select();
  if (searchInput.value) search();
}

async function search() {
  const query = searchInput.value;
  if (!query.trim()) return searchResults.replaceChildren();
  // Results from an older, slower query must not replace newer ones.
  const ticket = ++latestQuery;
  let result;
  try {
    result = await invoke('fs_search', { query });
  } catch (e) {
    return searchResults.replaceChildren(emptyState(String(e)));
  }
  if (ticket !== latestQuery) return;
  searchResults.replaceChildren();
  if (!result.hits.length) return searchResults.append(emptyState('No matches.'));
  let lastPath = null;
  for (const hit of result.hits) {
    if (hit.path !== lastPath) searchResults.append(h('div', { class: 'hit-file' }, (lastPath = hit.path)));
    searchResults.append(
      h(
        'div',
        { class: 'hit list-row', onclick: () => openFile(hit.path, hit.line) },
        h('span', { class: 'hit-line' }, String(hit.line)),
        h('span', { class: 'hit-text' }, hit.text),
      ),
    );
  }
  if (result.truncated) searchResults.append(emptyState(`Showing the first ${result.hits.length} matches.`));
}

export function setupFind() {
  let typingTimer;
  searchInput.oninput = () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(search, TYPING_DELAY_MS);
  };
  searchInput.onkeydown = (e) => {
    if (e.key === 'Escape') showView('tree');
  };
}
