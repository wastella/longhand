// The welcome screen, shown over the editor whenever no file is open. Before a folder is open it
// says what Longhand is and offers Open Folder and the recent folders; once one is open it points
// to the files.

import { h } from '../dom.js';
import { on, state } from '../state.js';
import { chooseFolder, forgetRecent, getRecents, onRecentsChanged, openFolder, refreshRecents } from './folders.js';
import { icon } from './icons.js';

const RECENTS_SHOWN = 6;

let region;

/** "Today", "Yesterday", "3 days ago", or a date, for when a folder was last opened. */
function sinceOpened(iso, now = new Date()) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(then).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const sameYear = then.getFullYear() === now.getFullYear();
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

function recentRow(recent) {
  // Existence is unknown (null) until the backend has checked; assume the folder is there.
  const exists = recent.exists !== false;
  const name = exists ? recent.name : `${recent.name} (missing)`;
  return h(
    'li',
    { class: 'recent' + (exists ? '' : ' missing'), 'data-path': recent.path },
    h(
      'button',
      {
        class: 'recent-open',
        'data-tip': exists ? `Open ${recent.path}` : `${recent.path} was moved or deleted`,
        onclick: () => openFolder(recent.path),
      },
      h('span', { class: 'recent-name truncate' }, recent.name),
      h('span', { class: 'recent-path truncate' }, recent.shortPath || recent.path),
      h('span', { class: 'recent-when' }, exists ? sinceOpened(recent.openedAt) : 'Missing'),
    ),
    h(
      'button',
      {
        class: 'button ghost icon-button small recent-remove',
        'aria-label': `Remove ${name} from Recent`,
        'data-tip': 'Remove from Recent',
        onclick: () => forgetRecent(recent.path),
      },
      icon('x', 'small'),
    ),
  );
}

function recentList() {
  const shown = getRecents().slice(0, RECENTS_SHOWN);
  if (!shown.length) return null;
  return h(
    'section',
    { class: 'recents', 'aria-labelledby': 'recents-label' },
    h('h2', { class: 'section-label', id: 'recents-label' }, 'Recent'),
    h('ul', { id: 'recent-list' }, shown.map(recentRow)),
  );
}

function noFolder() {
  return [
    h('h1', {}, 'Longhand'),
    h(
      'p',
      { class: 'welcome-lede' },
      'A code editor where you write every line. The tutor reads your code and answers your questions, like a TA in office hours.',
    ),
    h(
      'div',
      { class: 'welcome-actions' },
      h('button', { id: 'open-folder', class: 'button primary large', onclick: chooseFolder }, 'Open Folder…'),
      h('span', { class: 'dim' }, 'or drop a folder here'),
    ),
    recentList(),
  ];
}

function folderOpen(ws) {
  return [h('h1', { class: 'welcome-folder' }, ws.name), h('p', { class: 'welcome-lede' }, 'Pick a file on the left to start writing.')];
}

/** Draws the screen for the current state: no folder, or a folder with no file open. */
export function renderWelcome() {
  document.body.classList.toggle('no-folder', !state.workspace);
  region.replaceChildren(h('div', { class: 'welcome-inner' }, state.workspace ? folderOpen(state.workspace) : noFolder()));
}

export function mountWelcome(element) {
  region = element;
  renderWelcome();
  onRecentsChanged(renderWelcome);
  on('workspace:opened', () => {
    renderWelcome();
    refreshRecents();
  });
  on('editor:active', (path) => (region.hidden = Boolean(path)));
}
