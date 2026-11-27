// The lookup bar (⇧⌘K): a quick, direct answer in a popover that Escape dismisses. Lookups are
// not part of the conversation, and the tutor cannot read the folder for them (they are about the
// language, libraries, tools, errors and concepts). They go through the same engine, the
// folder's policy and the hidden-code check; the usage log counts them and, like conversations,
// their questions and answers are kept in this folder (one thread a day, `lookup-YYYY-MM-DD`).

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
const foot = h('div', { id: 'lookup-foot' }, 'Enter to look up · Esc to close · not added to the conversation, kept in .longhand/');
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

export const LOOKUP_PREFIX = 'lookup-';

/** Today's lookup thread, by the local date. */
function lookupThread(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${LOOKUP_PREFIX}${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
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
    thread: lookupThread(),
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
