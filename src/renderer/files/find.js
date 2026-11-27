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

/** How many characters stay before the first match, so the match itself is never cut off. */
const CONTEXT_CHARS = 6;

/** Drops the start of a long line so its first match shows in a narrow sidebar. */
function aroundMatch(text, ranges) {
  const first = ranges[0]?.[0] ?? 0;
  if (first <= CONTEXT_CHARS + 2) return { text, ranges };
  const cut = first - CONTEXT_CHARS;
  return { text: '…' + text.slice(cut), ranges: ranges.map(([start, end]) => [start - cut + 1, end - cut + 1]) };
}

function fileHeader(path, count) {
  const slash = path.lastIndexOf('/');
  return h(
    'div',
    { class: 'hit-file list-row', role: 'option', 'aria-expanded': 'true', 'aria-selected': 'false', title: path, onmousedown: (e) => e.preventDefault() },
    h('span', { class: 'hit-name' }, path.slice(slash + 1)),
    slash > 0 ? h('span', { class: 'hit-dir' }, path.slice(0, slash)) : null,
    h('span', { class: 'hit-count' }, String(count)),
  );
}

function hitRow(hit, i) {
  const shown = aroundMatch(hit.text, hit.ranges || []);
  return h(
    'div',
    { class: 'hit list-row', role: 'option', 'aria-selected': 'false', 'data-index': i, onmousedown: (e) => e.preventDefault() },
    h('span', { class: 'hit-line' }, String(hit.line)),
    h('span', { class: 'hit-text' }, marked(shown.text, shown.ranges)),
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
  current = null;
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
  searchResults.querySelectorAll('.hit-file, .hit').forEach((node, i) => (node.id = `result-${i}`));
}

// ---- moving through results: file headers and hits, like a tree ----

/** The header or hit with the keyboard focus, or null. */
let current = null;

const visibleItems = () => [...searchResults.querySelectorAll('.hit-file, .hit-group:not(.collapsed) .hit')];
const headerOf = (node) => node.closest('.hit-group').querySelector('.hit-file');

function setCurrent(node) {
  if (current) {
    current.classList.remove('active');
    current.setAttribute('aria-selected', 'false');
  }
  current = node;
  if (!node) return searchResults.removeAttribute('aria-activedescendant');
  node.classList.add('active');
  node.setAttribute('aria-selected', 'true');
  searchResults.setAttribute('aria-activedescendant', node.id);
  node.scrollIntoView({ block: 'nearest' });
}

function setCollapsed(header, collapsed) {
  header.parentElement.classList.toggle('collapsed', collapsed);
  header.setAttribute('aria-expanded', String(!collapsed));
}

function activate(node) {
  if (node.classList.contains('hit')) {
    const hit = hits[node.dataset.index];
    return openFile(hit.path, hit.line);
  }
  setCollapsed(node, !node.parentElement.classList.contains('collapsed'));
}

function moveBy(step) {
  const items = visibleItems();
  const next = items[items.indexOf(current) + step];
  if (next) return setCurrent(next);
  if (step < 0) {
    setCurrent(null);
    searchInput.focus();
  }
}

function onResultsKey(e) {
  if (!current) return;
  const isHeader = current.classList.contains('hit-file');
  const collapsed = isHeader && current.parentElement.classList.contains('collapsed');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') moveBy(e.key === 'ArrowDown' ? 1 : -1);
  else if (e.key === 'Enter') activate(current);
  else if (e.key === 'ArrowLeft') isHeader ? setCollapsed(current, true) : setCurrent(headerOf(current));
  else if (e.key === 'ArrowRight' && isHeader) collapsed ? setCollapsed(current, false) : moveBy(1);
  else if (e.key === 'Escape') searchInput.focus();
  else return;
  e.preventDefault();
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
      setCurrent(searchResults.querySelector('.hit-group:not(.collapsed) .hit'));
    }
  });
  searchResults.addEventListener('keydown', onResultsKey);
  searchResults.addEventListener('click', (e) => {
    const node = e.target.closest('.hit-file, .hit');
    if (!node) return;
    setCurrent(node);
    activate(node);
  });
  caseToggle.onclick = () => toggleOption(caseToggle);
  wordToggle.onclick = () => toggleOption(wordToggle);
}
