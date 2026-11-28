// The tutor engine's client. Every request to the tutor goes through tutorRequest: the side-panel
// conversation, the lookup bar, and anything else that wants an answer pinned to the student's
// work. Requests belong to threads the caller names; threads are independent and run at once.
// See "The tutor engine" in docs/ARCHITECTURE.md.

import { invoke, listen } from '../backend.js';

/** Requests waiting for events, by request id. */
const pending = new Map();
let listening = null;
let counter = 0;

function settle(entry, status, error) {
  if (!pending.delete(entry.id)) return;
  entry.resolve(error ? { status, text: entry.text, error } : { status, text: entry.text });
}

function dispatch(ev) {
  const entry = pending.get(ev.request);
  if (!entry) return;
  if (ev.type === 'text') {
    entry.text += ev.text;
    entry.onText?.(entry.text, ev.text);
  } else if (ev.type === 'tool') entry.onActivity?.({ tool: ev.name, target: ev.target });
  else if (ev.type === 'restarted') entry.onRestart?.();
  else if (ev.type === 'done') settle(entry, ev.cancelled ? 'cancelled' : 'done');
  else if (ev.type === 'error') settle(entry, 'error', { code: ev.code, message: ev.message, resetsAt: ev.resetsAt });
}

/** A backend refusal is a { code, message } failure; anything else becomes one. */
const asFailure = (error) => (error && error.code ? error : { code: 'failed', message: String(error?.message || error) });

/**
 * Asks the tutor something on `thread`.
 *
 *   thread      caller-chosen id: letters, digits, - and _ (for example 'conv-…', 'lookup')
 *   kind        'conversation' | 'lookup' | 'review' | 'failure': the thread's behaviour
 *   prompt      the full text for the model, context included
 *   question    what the student wrote, for the transcript (defaults to prompt)
 *   context     short labels for what was attached, for the transcript
 *   model       'haiku' | 'sonnet' | 'opus' (lookups default to haiku, others to the folder's)
 *   about       what the usage log files it under: question, explain, review, failure, lookup
 *   ephemeral   keep no transcript and no CLI session (default false; lookups keep a
 *               transcript but never a CLI session, and get no tools)
 *   retry       ask the thread's last question again without repeating it in the transcript
 *   onText(text, delta)          the answer so far, as it streams
 *   onActivity({ tool, target }) the tutor is reading or searching a file
 *   onRestart()                  the CLI session had expired; a new one has the transcript
 *
 * Requests on one thread take turns: a new one stops the one running there, which saves its
 * answer (as stopped) before the new question is added.
 *
 * Returns { id, done, cancel }. `done` always resolves, never rejects, with
 * { status: 'done' | 'cancelled' | 'error', text, error?: { code, message, resetsAt? } }.
 * Render answers with renderAnswer (markdown.js) so the hidden-code check applies to them.
 */
export function tutorRequest({ thread, kind = 'conversation', prompt, onText, onActivity, onRestart, ...options }) {
  const id = `r${Date.now().toString(36)}${(++counter).toString(36)}`;
  const entry = { id, text: '', onText, onActivity, onRestart };
  const done = new Promise((resolve) => (entry.resolve = resolve));
  pending.set(id, entry);
  listening ??= listen('tutor:event', dispatch);
  listening
    .then(() => invoke('tutor_request', { request: { id, thread, kind, prompt, ...options } }))
    .then(() => {
      // Stopped before the backend had the request: stop it now that it does.
      if (entry.stopped) invoke('tutor_cancel', { thread, request: id });
    })
    .catch((error) => settle(entry, 'error', asFailure(error)));
  const cancel = () => {
    entry.stopped = true;
    invoke('tutor_cancel', { thread, request: id });
    settle(entry, 'cancelled');
  };
  return { id, done, cancel };
}

/** Starts the CLI for the next request of `kind` ahead of time (lookups), to hide its start-up. */
export const prepareTutor = (kind = 'lookup', model) => invoke('tutor_prepare', { kind, model }).catch(() => {});

/** The folder's kept threads whose id starts with `prefix`: [{ id, kind, title, updated, messages }]. */
export const listThreads = (prefix) => invoke('tutor_threads', { prefix });

/** One kept thread: { id, kind, title, created, updated, messages: [{ role, text, at, context?, status? }] }, or null. */
export const loadThread = (id) => invoke('tutor_thread', { id });

/** The student's tutor use in this folder: { days: [{ date, asks, reveals }], total }. */
export const usageRecord = () => invoke('tutor_record');
