// The title bar: the folder's name, today's tutor use, and whether the tutor is connected.
// The bar is the window's drag handle, so its contents ignore the pointer (see shell.css).

import { h, spacer } from '../dom.js';
import { on } from '../state.js';

const name = h('span', { id: 'ws-name' }, 'Longhand');
const usage = h('span', { id: 'reliance', title: 'Your own record of tutor use in this folder. Stored in .longhand/log.jsonl' });
const auth = h('span', { id: 'auth', title: 'Tutor connection' });

function showUsage(log) {
  if (!log) return;
  const t = log.today;
  const parts = [`${t.ask} ${t.ask === 1 ? 'question' : 'questions'}`];
  if (t.reveal) parts.push(`${t.reveal} code ${t.reveal === 1 ? 'reveal' : 'reveals'}`);
  usage.textContent = `Today: ${parts.join(' · ')}`;
}

function showAuth(status) {
  if (!status.installed) {
    auth.className = 'bad';
    auth.textContent = 'Claude Code not found';
  } else if (!status.loggedIn) {
    auth.className = 'bad';
    auth.textContent = 'Not logged in';
  } else {
    auth.className = 'ok';
    auth.textContent = status.plan ? `Claude ${status.plan[0].toUpperCase()}${status.plan.slice(1)}` : 'Claude connected';
  }
}

export function mountTitleBar(region) {
  region.append(name, spacer(), usage, auth);
  on('workspace:opened', (ws) => {
    name.textContent = ws.name;
    showUsage(ws.log);
  });
  on('usage:changed', showUsage);
  on('auth:changed', showAuth);
}
