// Warns before quitting or opening another folder would stop a command running in a terminal.

import { invoke } from '../backend.js';

/** The shell's leave guard (see registerLeaveGuard): null, or what would be stopped. */
export async function runningCommands(reason) {
  const busy = await invoke('term_busy');
  if (!busy.length) return null;
  const named = busy.map((b) => b.command).filter(Boolean);
  let what;
  if (busy.length > 1) what = `${busy.length} commands are still running in the terminal${named.length ? ` (${named.join(', ')})` : ''}.`;
  else what = named.length ? `“${named[0]}” is still running in the terminal.` : 'A command is still running in the terminal.';
  const them = busy.length > 1 ? 'them' : 'it';
  return reason === 'quit'
    ? { message: `${what} Quit and stop ${them}?`, action: 'Stop and Quit' }
    : { message: `${what} Open another folder and stop ${them}?`, action: 'Stop and Open' };
}
