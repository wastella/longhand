// Quick open (⌘P): a palette that finds a file by typing part of its name or path. The list of
// files comes from the backend once and is reused until the folder changes on disk.

import { invoke } from '../backend.js';
import { h } from '../dom.js';
import { closeOnEscape } from '../shell/dismiss.js';
import { state } from '../state.js';
import { activeFile, openFile } from '../editor/index.js';
import { candidate, match, normalise } from './fuzzy.js';
import { recentFiles } from './memory.js';

const MAX_SHOWN = 50;

const input = h('input', {
  class: 'palette-input',
  placeholder: 'Go to file',
  spellcheck: 'false',
  role: 'combobox',
  'aria-label': 'Go to file',
  'aria-expanded': 'true',
  'aria-controls': 'quick-open-list',
  'aria-autocomplete': 'list',
});
const list = h('div', { id: 'quick-open-list', class: 'palette-list', role: 'listbox' });
const note = h('div', { class: 'palette-note' });
const palette = h('div', { id: 'quick-open', class: 'palette', role: 'dialog', 'aria-label': 'Go to file', hidden: true }, input, list, note);

/** The folder's files, or null before they are listed. */
let files = null;
let known = new Set();
let truncated = false;
let loadError = null;
let loading = null;
/** Bumped by every change on disk and every new folder. */
let changes = 0;
/** The value of `changes` when the shown list was requested. */
let listedAt = -1;
let folder = 0;

let results = [];
let current = 0;
let returnFocus = null;

/** Files changed on disk: list them again the next time the palette opens. */
export const markFilesStale = () => changes++;
const isStale = () => listedAt !== changes;

/** A different folder was opened. */
export function forgetFiles() {
  folder++;
  changes++;
  files = null;
  known = new Set();
  loading = null;
}

function load() {
  if (loading) return loading;
  const mine = folder;
  const askedAt = changes;
  loading = invoke('fs_files')
    .then(
      (listing) => {
        if (mine !== folder || listing.cancelled) return;
        files = listing.files.map(candidate);
        known = new Set(listing.files);
        truncated = listing.truncated;
        // A change that arrived while this was on its way leaves the list stale.
        listedAt = askedAt;
        loadError = null;
      },
      (e) => mine === folder && (loadError = String(e)),
    )
    .finally(() => mine === folder && (loading = null));
  return loading;
}

/** Recently opened files first (but not the one already showing), then the rest by path. */
function withoutQuery() {
  const here = activeFile()?.path;
  const recent = recentFiles().filter((p) => p !== here && (!files || known.has(p)));
  const out = recent.map((path) => ({ path, positions: [] }));
  const seen = new Set(recent);
  for (const c of files || []) {
    if (out.length >= MAX_SHOWN) break;
    if (!seen.has(c.path)) out.push({ path: c.path, positions: [] });
  }
  return out.slice(0, MAX_SHOWN);
}

function withQuery(query) {
  const recent = new Map(recentFiles().map((p, i) => [p, i]));
  const best = [];
  for (const c of files || []) {
    const m = match(c, query);
    if (!m) continue;
    // Among equally good matches, recently opened files come first.
    const score = m.score + (recent.has(c.path) ? 5 - recent.get(c.path) * 0.2 : 0);
    if (best.length === MAX_SHOWN && score <= best[best.length - 1].score) continue;
    let i = best.length;
    while (i > 0 && best[i - 1].score < score) i--;
    best.splice(i, 0, { path: c.path, positions: m.positions, score });
    if (best.length > MAX_SHOWN) best.pop();
  }
  return best;
}

/** `text` with the characters at `positions` (offset by `from`) marked. */
function marked(text, from, positions) {
  const hits = new Set(positions.filter((p) => p >= from && p < from + text.length).map((p) => p - from));
  const nodes = [];
  let run = '';
  let inMatch = false;
  for (let i = 0; i <= text.length; i++) {
    const hit = hits.has(i);
    if (i === text.length || hit !== inMatch) {
      if (run) nodes.push(inMatch ? h('span', { class: 'palette-match' }, run) : run);
      run = '';
      inMatch = hit;
    }
    if (i < text.length) run += text[i];
  }
  return nodes;
}

function row({ path, positions }, i) {
  const base = path.lastIndexOf('/') + 1;
  return h(
    'div',
    {
      id: `quick-open-${i}`,
      class: 'palette-row' + (i === current ? ' active' : ''),
      role: 'option',
      'aria-selected': String(i === current),
      'data-path': path,
      title: path,
      // Keep the focus in the field, so the palette stays open while choosing.
      onmousedown: (e) => e.preventDefault(),
      onmousemove: () => i !== current && setCurrent(i),
      onclick: () => choose(i),
    },
    h('span', { class: 'palette-name' }, marked(path.slice(base), base, positions)),
    base ? h('span', { class: 'palette-detail' }, marked(path.slice(0, base - 1), 0, positions)) : null,
  );
}

function render() {
  const query = normalise(input.value);
  results = query ? withQuery(query) : withoutQuery();
  current = 0;
  list.replaceChildren(...results.map(row));
  let message = '';
  if (loadError) message = `Could not list the folder's files: ${loadError}`;
  else if (!files && !results.length) message = 'Listing files…';
  else if (files && !files.length) message = 'This folder has no files yet.';
  else if (!results.length) message = 'No files match. Ignored folders such as .venv are left out.';
  else if (truncated) message = `Only the first ${files.length.toLocaleString()} files are searched.`;
  note.textContent = message;
  note.hidden = !message;
  showCurrent();
}

function setCurrent(i) {
  current = i;
  for (const node of list.children) {
    const on = node.id === `quick-open-${i}`;
    node.classList.toggle('active', on);
    node.setAttribute('aria-selected', String(on));
  }
  showCurrent();
}

function showCurrent() {
  const node = list.children[current];
  if (node) {
    input.setAttribute('aria-activedescendant', node.id);
    node.scrollIntoView({ block: 'nearest' });
  } else input.removeAttribute('aria-activedescendant');
}

function close({ restoreFocus = false } = {}) {
  if (palette.hidden) return;
  palette.hidden = true;
  if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
  returnFocus = null;
}

function choose(i) {
  const picked = results[i];
  if (!picked) return;
  close();
  openFile(picked.path);
}

export function openQuickOpen() {
  if (!state.workspace) return;
  if (palette.hidden) returnFocus = document.activeElement;
  palette.hidden = false;
  input.value = '';
  render();
  input.focus();
  if (isStale() || !files) load().then(() => !palette.hidden && render());
}

export function mountQuickOpen() {
  document.body.append(palette);
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    const down = e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n');
    const up = e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p');
    if (down || up) {
      e.preventDefault();
      if (results.length) setCurrent((current + (down ? 1 : -1) + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(current);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      close({ restoreFocus: true });
    }
  });
  input.addEventListener('blur', () => close());
  closeOnEscape(
    () => !palette.hidden,
    () => close({ restoreFocus: true }),
  );
}
