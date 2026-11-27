// The steps shown in place of the question box when Claude Code is missing, too old or logged out.

import { invoke } from '../backend.js';
import { h } from '../dom.js';
import { emit } from '../state.js';
import { showStatus } from '../shell/index.js';
import { typeInTerminal } from '../terminal/index.js';

const lead = h('p', {});
const steps = h('ol', { id: 'setup-steps' });
const checkButton = h('button', { id: 'setup-check', class: 'primary', onclick: () => recheckAuth() }, 'Check again');
export const setupBox = h(
  'div',
  { id: 'setup', hidden: true },
  h('h2', {}, 'Connect the tutor'),
  lead,
  steps,
  h('div', { class: 'row' }, checkButton, h('span', { class: 'dim' }, 'The editor, terminal and tests work without it.')),
);

export const isConnected = (auth) => auth.installed && auth.loggedIn && !auth.tooOld;

function step(title, command, note) {
  const item = h('li', {}, h('div', { class: 'step-title' }, title));
  if (command)
    item.append(
      h('div', { class: 'command' }, h('code', {}, command), h('button', { class: 'ghost', onclick: () => typeInTerminal(command) }, 'Type in terminal')),
    );
  if (note) item.append(h('div', { class: 'dim step-note' }, note));
  return item;
}

/** Shows the setup steps that apply to `auth`, or hides them when the tutor is connected. */
export function showSetup(auth) {
  setupBox.hidden = isConnected(auth);
  if (setupBox.hidden) return;
  const items = [];
  if (!auth.installed) {
    lead.textContent = 'The tutor runs on your own Claude subscription, through Claude Code on this computer. Claude Code is not installed yet.';
    items.push(step('Install Claude Code', 'curl -fsSL https://claude.ai/install.sh | bash'));
  } else if (auth.tooOld) {
    const version = auth.version ? ` ${auth.version}` : '';
    lead.textContent = `Claude Code${version} is installed but too old for the tutor's read-only mode.`;
    items.push(step('Update Claude Code', 'claude update'));
  } else lead.textContent = 'The tutor runs on your own Claude subscription, through Claude Code on this computer. Claude Code is installed but not logged in.';
  if (!auth.loggedIn) items.push(step('Log in with your Claude account', 'claude', 'Follow the prompts, then quit it with /exit.'));
  items.push(step('Come back here and press Check again'));
  steps.replaceChildren(...items);
}

/** Asks the backend again whether Claude Code is installed, new enough and logged in. */
export async function recheckAuth() {
  checkButton.disabled = true;
  const auth = await invoke('auth_status');
  await emit('auth:changed', auth);
  checkButton.disabled = false;
  if (!isConnected(auth)) showStatus('Still not connected. Finish the steps above and try again.', 6000);
}
