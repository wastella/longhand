// The open terminals (at most four) and which one is in front, with the strip of tabs, the "+"
// and Restart in the bottom panel's header.

import { confirm, invoke } from '../backend.js';
import { h } from '../dom.js';
import { showStatus } from '../shell/index.js';
import { TerminalSession } from './session.js';

export const MAX_TERMINALS = 4;

export const pane = h('div', { id: 'terminal', class: 'bottom-pane' });
const strip = h('span', { id: 'terminal-tabs', role: 'tablist', 'aria-label': 'Terminals' });
const addButton = h(
  'button',
  { id: 'terminal-add', class: 'ghost', title: 'New terminal (⌃⇧`)', 'aria-label': 'New terminal', onclick: () => addTerminal() },
  '+',
);
const restartButton = h('button', { id: 'terminal-restart', class: 'ghost', title: 'Start this terminal again', onclick: () => restartTerminal() }, 'Restart');
export const actions = h('span', { id: 'terminal-actions' }, strip, addButton, restartButton);

/** In tab order. */
export const sessions = [];
let active = null;

export const activeSession = () => active;
export const sessionById = (id) => sessions.find((s) => s.id === id);

function renderTabs() {
  // One terminal needs no tabs; the strip appears with the second.
  strip.hidden = sessions.length < 2;
  strip.replaceChildren(
    ...sessions.map((s) => {
      const label = `Terminal ${s.number}`;
      return h(
        'span',
        { class: 'term-tab' + (s === active ? ' active' : '') + (s.exited ? ' exited' : '') },
        h(
          'button',
          {
            class: 'term-tab-name',
            role: 'tab',
            'aria-selected': String(s === active),
            title: s.exited ? `${label} (exited)` : label,
            onclick: () => activate(s),
          },
          String(s.number),
        ),
        h('button', { class: 'term-tab-close', title: `Close ${label}`, 'aria-label': `Close ${label}`, onclick: () => closeTerminal(s) }, '×'),
      );
    }),
  );
  addButton.disabled = sessions.length >= MAX_TERMINALS;
  addButton.title = addButton.disabled ? `At most ${MAX_TERMINALS} terminals` : 'New terminal (⌃⇧`)';
}

export function activate(session) {
  active?.hide();
  active = session;
  session.show();
  renderTabs();
}

/** The lowest label not in use, so labels stay put as terminals come and go. */
function freeNumber() {
  let n = 1;
  while (sessions.some((s) => s.number === n)) n++;
  return n;
}

/**
 * Opens another terminal in front of the others and starts its shell. Returns it, or null when
 * the most are already open. Call it while the pane is showing, so the new view can be measured.
 */
export function addTerminal({ start = true } = {}) {
  if (sessions.length >= MAX_TERMINALS) {
    showStatus(`At most ${MAX_TERMINALS} terminals can be open. Close one first.`);
    return null;
  }
  const session = new TerminalSession(freeNumber(), renderTabs);
  sessions.push(session);
  sessions.sort((a, b) => a.number - b.number);
  active?.hide();
  session.open(pane);
  activate(session);
  if (start) session.start();
  return session;
}

/** The command running in `session`, '' when it is unnamed, or null when the shell is idle. */
async function runningIn(session) {
  if (!session.id) return null;
  const busy = await invoke('term_busy');
  const entry = busy.find((b) => b.id === session.id);
  return entry ? entry.command || '' : null;
}

/** Asks before stopping a command running in `session`; resolves false if the student backs out. */
async function confirmStop(session, doing, action) {
  const command = await runningIn(session);
  if (command === null) return true;
  const what = command ? `“${command}” is still running` : 'A command is still running';
  return confirm(`${what} in terminal ${session.number}. ${doing} and stop it?`, action);
}

export async function closeTerminal(session) {
  if (sessions.length < 2 || !(await confirmStop(session, 'Close the terminal', 'Close Terminal'))) return;
  const i = sessions.indexOf(session);
  sessions.splice(i, 1);
  session.dispose();
  if (session === active) {
    active = null;
    activate(sessions[Math.min(i, sessions.length - 1)]);
  } else renderTabs();
}

export async function restartTerminal(session = active) {
  if (await confirmStop(session, 'Restart the terminal', 'Restart')) session.start();
}

/** For a newly opened folder, whose shells the backend has already stopped: one fresh terminal. */
export function resetTerminals() {
  for (const session of sessions) session.id = null;
  const [first, ...rest] = sessions;
  for (const session of rest) session.dispose();
  sessions.splice(1);
  activate(first);
  first.start();
}
