// Guards against losing work when the student quits or switches folder. An area that holds
// something losable (unsaved edits, a running process) registers a guard; whoever is about to
// leave calls confirmLeave first.

import { confirm, onCloseRequested } from '../backend.js';

const guards = new Set();

/**
 * Registers `guard(reason)`, where reason is 'quit' or 'folder'. It returns null when there is
 * nothing to lose, or { message, action } describing what would be lost and the label of the
 * button that goes ahead anyway. Returns a function that removes the guard.
 */
export function registerLeaveGuard(guard) {
  guards.add(guard);
  return () => guards.delete(guard);
}

/** Asks the student about each thing that would be lost. Resolves false if they back out. */
export async function confirmLeave(reason) {
  for (const guard of guards) {
    const risk = await guard(reason);
    if (risk && !(await confirm(risk.message, risk.action))) return false;
  }
  return true;
}

export function mountLeaveGuards() {
  onCloseRequested(async (event) => {
    if (!(await confirmLeave('quit'))) event.preventDefault();
  });
}
