// Run > Run File: saves the Python file in the editor and runs it in a terminal that is free.

import { invoke } from '../backend.js';
import { state } from '../state.js';
import { activeFile, save } from '../editor/index.js';
import { showBottomPane, showStatus } from '../shell/index.js';
import { activate, activeSession, addTerminal, sessions } from './terminals.js';

// Ctrl+E then Ctrl+U: clears anything half-typed at the prompt so the command runs alone.
const CLEAR_LINE = '\x05\x15';

/**
 * The terminal to run in: the one in front if its shell is idle, else another idle one, else one
 * whose shell exited (started again), else a new one. Null when every terminal is busy.
 */
async function freeTerminal() {
  const busy = new Set((await invoke('term_busy')).map((b) => b.id));
  const idle = (s) => s.id && !busy.has(s.id);
  const choice = [activeSession(), ...sessions].find(idle);
  if (choice) return (activate(choice), choice);
  const stopped = sessions.find((s) => !s.id);
  if (!stopped) return addTerminal();
  activate(stopped);
  await stopped.start();
  return stopped.id ? stopped : null;
}

export async function runFile() {
  if (!state.workspace) return;
  const file = activeFile();
  if (!file || !file.path.endsWith('.py')) return showStatus('Open a Python file to run it.');
  if (file.dirty && !(await save(file.path))) return;
  showBottomPane('terminal');
  const session = await freeTerminal();
  if (!session) return showStatus('Every terminal is busy. Stop a command (Ctrl+C) or close a terminal, then run again.', 6000);
  try {
    const command = await invoke('term_run_command', { id: session.id, path: file.path });
    await invoke('term_input', { id: session.id, data: CLEAR_LINE + command + '\r' });
  } catch (e) {
    showStatus(`Could not run ${file.path}: ${e}`, 8000);
  }
}
