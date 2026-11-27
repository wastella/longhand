// A failed tutor request, shown as a sentence the student can act on, with the one action that
// helps: retry, set up the CLI again, or update it.

import { h } from '../dom.js';
import { typeInTerminal } from '../terminal/index.js';
import { recheckAuth } from './setup.js';

/**
 * When a usage limit resets, in the student's own clock: "at 3:40 pm" today, otherwise with the
 * date, "on Mon 30 Nov at 3:40 pm" (and the year when it is not this one).
 */
export function resetTime(seconds, now = new Date()) {
  const at = new Date(seconds * 1000);
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (at.toDateString() === now.toDateString()) return `at ${time}`;
  const year = at.getFullYear() === now.getFullYear() ? undefined : 'numeric';
  return `on ${at.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year })} at ${time}`;
}

/** The sentence for `error` ({ code, message, resetsAt }). */
export function failureText(error) {
  if (error.code === 'rate-limited')
    return error.resetsAt ? `You have reached your Claude usage limit. It resets ${resetTime(error.resetsAt)}.` : error.message;
  return error.message;
}

const SETUP_CODES = new Set(['not-installed', 'logged-out']);

/**
 * The error block for `error`. `retry` (optional) asks again; it is offered where trying again
 * can help.
 */
export function failureView(error, retry) {
  const actions = h('div', { class: 'row' });
  if (SETUP_CODES.has(error.code)) actions.append(h('button', { onclick: () => recheckAuth() }, 'Check again'));
  else if (error.code === 'too-old') actions.append(h('button', { onclick: () => typeInTerminal('claude update') }, 'Type claude update in the terminal'));
  if (retry && !needsSetup(error) && !['read-only', 'invalid', 'no-folder'].includes(error.code))
    actions.append(h('button', { class: 'retry', onclick: retry }, error.code === 'rate-limited' ? 'Try again' : 'Retry'));
  return h('div', { class: `msg error ${error.code}`, role: 'alert' }, h('p', {}, failureText(error)), actions.childElementCount ? actions : null);
}

/** Setup problems mean the connection status shown elsewhere is stale. */
export const needsSetup = (error) => SETUP_CODES.has(error.code) || error.code === 'too-old';
