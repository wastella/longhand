// Find in files: plain-text search across the folder, results grouped by file with each match
// marked, and hits that open at their line. The backend skips ignored, binary and large files.

import { invoke } from '../backend.js';
import { emptyState, h } from '../dom.js';
import { state } from '../state.js';
import { activeFile, openFile } from '../editor/index.js';
import { showPanel } from '../shell/index.js';
import { caseToggle, searchInput, searchResults, searchSummary, showView, treeView, wordToggle } from './panel.js';

const TYPING_DELAY_MS = 200;
const SLOW_MS = 150;
let latest = 0;
let typingTimer;
let hits = [];
let current = -1;

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

/** Clears the last folder's results. */
export function resetFind() {
  latest++;
  searchInput.value = '';
  showResults(null);
}

const pressed = (button) => button.getAttribute('aria-pressed') === 'true';
const plural = (n, one, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;

async function search() {
  clearTimeout(typingTimer);
  const query = searchInput.value;
  // Each search gets a ticket; results from an older, slower one must not replace newer ones.
  const ticket = ++latest;
  if (!query) return showResults(null);
  const slow = setTimeout(() => ticket === latest && (searchSummary.textContent = 'Searching…'), SLOW_MS);
  let result;
  try {
    result = await invoke('fs_search', { query, caseSensitive: pressed(caseToggle), wholeWord: pressed(wordToggle) });
  } catch (e) {
    result = { error: String(e) };
  } finally {
    clearTimeout(slow);
  }
  if (ticket !== latest || result.cancelled) return;
  showResults(result);
}

function marked(text, ranges) {
  const nodes = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) nodes.push(text.slice(at, start));
    nodes.push(h('mark', { class: 'hit-match' }, text.slice(start, end)));
    at = end;
  }
  nodes.push(text.slice(at));
  return nodes;
}

function fileHeader(path, count) {
  const slash = path.lastIndexOf('/');
  const header = h(
    'div',
    { class: 'hit-file list-row', title: path },
    h('span', { class: 'hit-name' }, path.slice(slash + 1)),
    slash > 0 ? h('span', { class: 'hit-dir' }, path.slice(0, slash)) : null,
    h('span', { class: 'hit-count' }, String(count)),
  );
  header.onclick = () => header.parentElement.classList.toggle('collapsed');
  return header;
}

function hitRow(hit, i) {
  return h(
    'div',
    {
      id: `hit-${i}`,
      class: 'hit list-row',
      role: 'option',
      'data-index': i,
      onmousedown: (e) => e.preventDefault(),
      onclick: () => (setCurrent(i), openHit(i)),
    },
    h('span', { class: 'hit-line' }, String(hit.line)),
    h('span', { class: 'hit-text' }, marked(hit.text, hit.ranges || [])),
  );
}

function summaryOf(result) {
  const parts = [`${plural(result.hits.length, 'result')} in ${plural(result.files, 'file')}`];
  if (result.truncated) parts.push(`Showing the first ${result.hits.length.toLocaleString()}; type more to narrow the search.`);
  if (result.skipped) parts.push(`Skipped ${plural(result.skipped, 'file')} over 1 MB.`);
  return parts.map((text) => h('div', {}, text));
}

/** Shows a result from the backend, or clears the view when `result` is null. */
function showResults(result) {
  hits = result?.hits || [];
  current = -1;
  searchResults.removeAttribute('aria-activedescendant');
  searchSummary.replaceChildren();
  if (!result) return searchResults.replaceChildren();
  if (result.error) return searchResults.replaceChildren(emptyState(`Search failed: ${result.error}`));
  if (!hits.length) {
    if (result.skipped) searchSummary.replaceChildren(...summaryOf(result).slice(1));
    return searchResults.replaceChildren(emptyState('No matches.'));
  }
  searchSummary.replaceChildren(...summaryOf(result));
  const groups = [];
  hits.forEach((hit, i) => {
    let group = groups.at(-1);
    if (group?.path !== hit.path) groups.push((group = { path: hit.path, rows: [] }));
    group.rows.push(hitRow(hit, i));
  });
  searchResults.replaceChildren(...groups.map((g) => h('div', { class: 'hit-group' }, fileHeader(g.path, g.rows.length), g.rows)));
}

function setCurrent(i) {
  current = i;
  for (const node of searchResults.querySelectorAll('.hit.active')) node.classList.remove('active');
  const node = document.getElementById(`hit-${i}`);
  if (!node) return;
  node.classList.add('active');
  node.closest('.hit-group').classList.remove('collapsed');
  searchResults.setAttribute('aria-activedescendant', node.id);
  node.scrollIntoView({ block: 'nearest' });
}

function openHit(i) {
  const hit = hits[i];
  if (hit) openFile(hit.path, hit.line);
}

function moveInResults(step) {
  const next = current + step;
  if (next < 0) {
    current = -1;
    searchResults.querySelector('.hit.active')?.classList.remove('active');
    return searchInput.focus();
  }
  if (next < hits.length) setCurrent(next);
}

function toggleOption(button) {
  button.setAttribute('aria-pressed', String(!pressed(button)));
  searchInput.focus();
  search();
}

export function setupFind() {
  searchInput.addEventListener('input', () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(search, TYPING_DELAY_MS);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      showView('tree');
      treeView.focus();
    } else if (e.key === 'Enter') search();
    else if (e.key === 'ArrowDown' && hits.length) {
      e.preventDefault();
      searchResults.focus();
      setCurrent(0);
    }
  });
  searchResults.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveInResults(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' && current >= 0) {
      e.preventDefault();
      openHit(current);
    } else if (e.key === 'Escape') searchInput.focus();
  });
  caseToggle.onclick = () => toggleOption(caseToggle);
  wordToggle.onclick = () => toggleOption(wordToggle);
}
