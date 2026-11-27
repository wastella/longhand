// The handout pane: the assignment's handout, read-only, beside the code. Which file it shows,
// whether it is open and its width are remembered per folder (memory.js). When a folder opens,
// the likely handout is found (find.js) and, if its name says it is one, offered once in a
// notification; the pane never opens by itself over the student's work. The title bar's toggle
// and View > Show or Hide Handout show and hide it.

import { invoke } from '../backend.js';
import { h, paneHead } from '../dom.js';
import { on, state } from '../state.js';
import { hidePanel, isPanelShown, notify, registerCommand, setPanel, showPanel } from '../shell/index.js';
import { canBeHandout, nameOf } from './files.js';
import { guessHandout } from './find.js';
import { loadMemory, recall, remember } from './memory.js';
import { showFile } from './view.js';

const title = h('span', { class: 'handout-name truncate' });
const body = h('div', { class: 'handout-body' });

/** The file the pane shows: the student's choice, else the guess; null when there is neither. */
let shownPath = null;
let guess = null;
let view = null;
let generation = 0;
/** Dismisses the notification offering the handout, once it is no longer needed. */
let dismissOffer = () => {};

const handoutPath = () => recall().handout || guess?.path || null;

function emptyState() {
  return h(
    'div',
    { class: 'empty-state centered' },
    h('strong', {}, 'No handout'),
    'To read an assignment beside your code, right-click its PDF or Markdown file in the files panel and choose Open as Handout.',
  );
}

/** Draws the handout (again, when `force`) if the pane is open. */
function render(force = false) {
  if (!recall().open) return;
  const path = handoutPath();
  if (path === shownPath && view && !force) return;
  view?.destroy();
  view = null;
  shownPath = path;
  title.textContent = path ? nameOf(path) : '';
  title.dataset.tip = path || '';
  if (!path) return body.replaceChildren(emptyState());
  view = showFile(body, path);
}

function open() {
  dismissOffer();
  remember({ open: true });
  showPanel('handout');
  render();
}

function close() {
  remember({ open: false });
  hidePanel('handout');
}

/** Shows `path` (a PDF or Markdown file in the folder) in the handout pane, and remembers it. */
export function openAsHandout(path) {
  if (!state.workspace || !canBeHandout(path)) return;
  remember({ handout: path });
  open();
}

/** Follows a file or folder renamed in the files panel, if the handout is in it. */
export function moveHandout(from, to) {
  const chosen = recall().handout;
  const inside = (path) => path === from || path?.startsWith(from + '/');
  if (inside(chosen)) remember({ handout: to + chosen.slice(from.length) });
  if (inside(guess?.path)) guess = { ...guess, path: to + guess.path.slice(from.length) };
  if (inside(shownPath)) render(true);
}

/** The file the handout pane shows (or would show once opened), or null. */
export const currentHandout = handoutPath;

async function folderOpened(ws) {
  const memory = loadMemory(ws.path);
  const mine = ++generation;
  view?.destroy();
  view = null;
  shownPath = null;
  guess = null;
  dismissOffer();
  // At once, before anything awaits, so the pane never shows the last folder's choice.
  setPanel('handout', { open: memory.open, size: memory.size });
  body.replaceChildren();
  let entries = [];
  try {
    entries = await invoke('fs_list', { rel: '' });
  } catch {
    // An unreadable folder has no handout to guess; the student can still choose one.
  }
  if (mine !== generation) return;
  guess = guessHandout(entries);
  render();
  if (guess?.named && !memory.handout && !memory.offered && !memory.open) {
    remember({ offered: true });
    dismissOffer = notify({
      message: `${nameOf(guess.path)} looks like this assignment's handout.`,
      action: { label: 'Show Beside Code', run: () => openAsHandout(guess.path) },
    });
  }
}

export function mountHandout(region) {
  region.append(paneHead(h('span', { class: 'handout-label' }, 'Handout'), title), body);
  registerCommand('toggle-handout', () => state.workspace && (isPanelShown('handout') ? close() : open()));
  on('workspace:opened', folderOpened);
  on('panel:resized', ({ id, size }) => id === 'handout' && remember({ size }));
  // The handout follows its file: a new version is shown, a deleted one says so.
  on('files:changed', (paths) => {
    if (shownPath && paths.some((path) => path === '' || shownPath === path || shownPath.startsWith(path + '/'))) render(true);
  });
  on('editor:saved', (path) => path === shownPath && render(true));
}
