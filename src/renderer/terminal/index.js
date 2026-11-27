// The terminal: up to four login shells in the open folder, each in its own xterm.js view, in
// the bottom panel. Other areas import from this file only.

import { invoke, listen } from '../backend.js';
import { on } from '../state.js';
import { addBottomPane, registerCommand, registerLeaveGuard, showBottomPane } from '../shell/index.js';
import { runningCommands } from './leave-guard.js';
import { runFile } from './run-file.js';
import { stopEarlierShells } from './session.js';
import { actions, activeSession, addTerminal, pane, resetTerminals, sessionById, sessions } from './terminals.js';
import { terminalFontSize, terminalTheme } from './theme.js';

/** Sends `text` to the terminal in front as if typed (end it with \r to run it). Resolves once the shell has it. */
export async function sendToTerminal(text) {
  const id = activeSession()?.id;
  if (id) await invoke('term_input', { id, data: text });
}

/** Brings the terminal to the front, then types `text` into it for the student to run. */
export function typeInTerminal(text) {
  showBottomPane('terminal');
  sendToTerminal(text);
}

/** The size in characters of the terminal in front, as { cols, rows }. */
export function terminalSize() {
  const { cols, rows } = activeSession().xterm;
  return { cols, rows };
}

export function mount() {
  stopEarlierShells();
  addBottomPane({ name: 'terminal', label: 'Terminal', body: pane, actions, onShow: () => activeSession().show() });
  addTerminal({ start: false });

  listen('term:data', ({ id, data, bytes }) => sessionById(id)?.receive(data, bytes));
  listen('term:exit', ({ id, code }) => sessionById(id)?.exitedWith(code));

  registerCommand('run-file', runFile);
  registerCommand('new-terminal', () => {
    showBottomPane('terminal');
    addTerminal();
  });
  registerLeaveGuard(runningCommands);

  on('workspace:opened', resetTerminals);
  on('panel:toggled', ({ id, visible }) => id === 'bottom' && visible && activeSession().fitSoon());
  on('text-size:changed', (size) => sessions.forEach((s) => s.setFontSize(terminalFontSize(size))));
  on('theme:changed', () => {
    const theme = terminalTheme();
    sessions.forEach((s) => s.setTheme(theme));
  });
  // The monospace font may finish loading after the first measurement.
  document.fonts?.ready.then(() => sessions.forEach((s) => s.fitSoon()));
}
