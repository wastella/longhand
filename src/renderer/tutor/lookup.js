// The lookup bar (⇧⌘K): a quick, direct answer in a popover that Escape dismisses. Lookups are
// not part of the conversation and are kept nowhere, but they go through the same read-only
// engine, the folder's policy and the hidden-code check, and the usage log counts them.

import { h } from '../dom.js';
import { state } from '../state.js';
import { prepareTutor, tutorRequest } from './engine.js';
import { failureView, needsSetup } from './errors.js';
import { renderAnswer } from './markdown.js';
import { recheckAuth } from './setup.js';

const field = h('input', {
  id: 'lookup-input',
  class: 'text-input',
  type: 'text',
  autocomplete: 'off',
  spellcheck: 'false',
  placeholder: 'Look up a function, an error message, a term…',
  'aria-label': 'Look up',
});
const answer = h('div', { id: 'lookup-answer', class: 'msg tutor', 'aria-live': 'polite', hidden: true });
const foot = h('div', { id: 'lookup-foot' }, 'Enter to look up · Esc to close · not added to the conversation');
const form = h('form', { id: 'lookup-form' }, field);
export const lookupBar = h('div', { id: 'lookup', role: 'dialog', 'aria-label': 'Look up', hidden: true }, form, answer, foot);

/** The lookup in progress, if any. */
let current = null;
let returnFocus = null;

function stop() {
  current?.handle.cancel();
  current = null;
}

export function openLookup() {
  if (!state.workspace) return;
  if (lookupBar.hidden) returnFocus = document.activeElement;
  lookupBar.hidden = false;
  field.focus();
  field.select();
  // Start the CLI now, so its start-up is spent while the student types.
  prepareTutor('lookup');
}

export function closeLookup() {
  if (lookupBar.hidden) return;
  stop();
  lookupBar.hidden = true;
  answer.hidden = true;
  answer.replaceChildren();
  returnFocus?.focus?.();
}

function look(question) {
  stop();
  answer.hidden = false;
  answer.replaceChildren(h('span', { class: 'thinking' }, 'Looking up…'));
  const message = { revealed: new Set(), streaming: true, frame: 0 };
  const draw = () => {
    message.frame = 0;
    if (current === message) renderAnswer(answer, message.text, message);
  };
  message.handle = tutorRequest({
    thread: 'lookup',
    kind: 'lookup',
    prompt: question,
    about: 'lookup',
    onText: (text) => {
      message.text = text;
      message.frame ||= requestAnimationFrame(draw);
    },
  });
  current = message;
  message.handle.done.then((result) => {
    if (current !== message) return;
    current = null;
    message.streaming = false;
    cancelAnimationFrame(message.frame);
    if (result.status === 'error') {
      answer.replaceChildren(failureView(result.error));
      if (needsSetup(result.error)) recheckAuth();
    } else if (result.text.trim()) renderAnswer(answer, result.text, message);
    else answer.hidden = true;
  });
}

export function setupLookup() {
  document.body.append(lookupBar);
  form.onsubmit = (e) => {
    e.preventDefault();
    if (field.value.trim()) look(field.value.trim());
  };
  lookupBar.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeLookup();
    }
  });
  // A click anywhere else puts the bar away.
  document.addEventListener('mousedown', (e) => !lookupBar.hidden && !lookupBar.contains(e.target) && closeLookup());
}
