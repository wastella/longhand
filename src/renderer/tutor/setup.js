// The steps shown in place of the question box when Claude Code is missing or logged out.

import { invoke } from '../backend.js';
import { h } from '../dom.js';
import { emit } from '../state.js';
import { showStatus } from '../shell/index.js';
import { typeInTerminal } from '../terminal/index.js';

const steps = h('ol', { id: 'setup-steps' });
const checkButton = h('button', { id: 'setup-check', class: 'primary', onclick: () => recheckAuth() }, 'Check again');
export const setupBox = h(
  'div',
  { id: 'setup', hidden: true },
  h('h2', {}, 'Connect the tutor'),
  h('p', {}, 'The tutor runs on your own Claude subscription, through Claude Code on this computer. The editor, terminal and tests work without it.'),
  steps,
  checkButton,
);

export const isConnected = (auth) => auth.installed && auth.loggedIn;

function step(text, command) {
  const item = h('li', {}, text);
  if (command) item.append(h('code', {}, command), h('button', { onclick: () => typeInTerminal(command) }, 'Type it in the terminal'));
  return item;
}

/** Shows the setup steps that apply to `auth`, or hides them when the tutor is connected. */
export function showSetup(auth) {
  setupBox.hidden = isConnected(auth);
  if (setupBox.hidden) return;
  const items = [
    step('Log in with your Claude account. Run this, follow the prompts, then quit it with /exit:', 'claude'),
    step('Come back here and press Check again.'),
  ];
  if (!auth.installed) items.unshift(step('Install Claude Code:', 'curl -fsSL https://claude.ai/install.sh | bash'));
  steps.replaceChildren(...items);
}

/** Asks the backend again whether Claude Code is installed and logged in. */
export async function recheckAuth() {
  checkButton.disabled = true;
  const auth = await invoke('auth_status');
  await emit('auth:changed', auth);
  checkButton.disabled = false;
  if (!isConnected(auth)) showStatus('Still not connected. Finish the steps above and try again.', 6000);
}
