// The title bar: panel toggles, the folder's name, today's tutor use and whether the tutor is
// connected. The whole bar drags the window (data-tauri-drag-region="deep" in index.html);
// Tauri leaves buttons out of the drag, so they stay clickable and everything keeps its tooltip.

import { h, spacer } from '../dom.js';
import { on } from '../state.js';
import { runCommand } from './commands.js';
import { icon } from './icons.js';

const name = h('span', { id: 'ws-name', class: 'truncate' }, 'Longhand');
const usage = h('span', { id: 'reliance', 'data-tip': 'Your own record of tutor use in this folder, kept in .longhand/log.jsonl' });
const auth = h('span', { id: 'auth', 'data-tip': 'Tutor connection' });

const toggles = {
  files: ['panel-left', 'Files', 'toggle-files'],
  bottom: ['panel-bottom', 'Terminal and tests', 'toggle-bottom'],
  tutor: ['panel-right', 'Tutor', 'toggle-tutor'],
};
const toggleButtons = Object.fromEntries(
  Object.entries(toggles).map(([id, [iconName, label, command]]) => [
    id,
    h(
      'button',
      {
        id: `toggle-${id}-panel`,
        class: 'button ghost icon-button',
        'aria-label': label,
        'aria-pressed': 'true',
        'data-tip-command': command,
        onclick: () => runCommand(command),
      },
      icon(iconName),
    ),
  ]),
);

function showToggle(id, visible) {
  const button = toggleButtons[id];
  button.setAttribute('aria-pressed', String(visible));
  button.dataset.tip = `${visible ? 'Hide' : 'Show'} ${toggles[id][1].toLowerCase()}`;
}

function showUsage(log) {
  if (!log) return;
  const t = log.today;
  const parts = [`${t.ask} ${t.ask === 1 ? 'question' : 'questions'}`];
  if (t.reveal) parts.push(`${t.reveal} code ${t.reveal === 1 ? 'reveal' : 'reveals'}`);
  usage.textContent = `Today: ${parts.join(' · ')}`;
}

function showAuth(status) {
  // tooOld: Claude Code is installed but older than the tutor needs (the tutor's setup explains).
  const tooOld = status?.tooOld === true;
  const ok = Boolean(status?.installed && status?.loggedIn && !tooOld);
  let text = 'Claude connected';
  if (!status?.installed) text = 'Claude Code not found';
  else if (tooOld) text = 'Claude Code needs updating';
  else if (!status.loggedIn) text = 'Not logged in';
  else if (status.plan) text = `Claude ${status.plan[0].toUpperCase()}${status.plan.slice(1)}`;
  auth.className = ok ? 'ok' : 'bad';
  auth.replaceChildren(h('span', { class: `status-dot ${ok ? 'success' : 'danger'}` }), text);
  auth.dataset.tip = ok
    ? 'The tutor is connected through Claude Code'
    : tooOld
      ? 'The tutor needs a newer Claude Code. The tutor panel shows how to update it.'
      : 'The tutor needs Claude Code. The tutor panel shows how to set it up.';
}

export function mountTitleBar(region) {
  region.append(toggleButtons.files, name, spacer(), usage, auth, h('span', { class: 'titlebar-toggles' }, toggleButtons.bottom, toggleButtons.tutor));
  // The panels, and so their toggles, appear once a folder is open.
  for (const id of Object.keys(toggles)) {
    showToggle(id, false);
    toggleButtons[id].hidden = true;
  }
  on('panel:toggled', ({ id, visible }) => toggleButtons[id] && showToggle(id, visible));
  on('workspace:opened', (ws) => {
    for (const button of Object.values(toggleButtons)) button.hidden = false;
    name.textContent = ws.name;
    name.dataset.tip = ws.path;
    showUsage(ws.log);
  });
  on('usage:changed', showUsage);
  on('auth:changed', showAuth);
}
