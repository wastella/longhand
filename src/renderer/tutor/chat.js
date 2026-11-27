// The conversation: sending questions, and drawing the tutor's answer as it streams in.

import { invoke } from '../backend.js';
import { h } from '../dom.js';
import { emit, state } from '../state.js';
import { form, input, setBusy, takeAttachment } from './composer.js';
import { buildPrompt } from './context.js';
import { renderAnswer } from './markdown.js';
import { recheckAuth } from './setup.js';

export const chat = h('div', { id: 'chat' });

const TOOL_VERBS = { Read: 'Reading', Grep: 'Searching for', Glob: 'Looking for' };
// Keep following the answer only if the student has not scrolled up to read something else.
const PINNED_WITHIN_PX = 60;

let busy = false;
/** The backend's number for the latest question; events from older ones are ignored. */
let generation = 0;
/** The answer being streamed: { node, text, revealed, streaming, activity, frame }. */
let current = null;

const scrollToEnd = () => (chat.scrollTop = chat.scrollHeight);

function introduction() {
  return h(
    'div',
    { class: 'empty' },
    'The tutor can read this folder but cannot edit files or run anything.',
    h(
      'ul',
      {},
      h('li', {}, 'Ask what a function, error or equation means and get a straight answer.'),
      h('li', {}, 'Ask for a review of code you have written.'),
      h('li', {}, 'When a test fails, use ', h('b', {}, 'Ask tutor'), ' on it and say what you expected.'),
    ),
    'It will not write your assignment.',
  );
}

/** Clears the conversation on screen. */
export const clearChat = () => chat.replaceChildren(introduction());

/** Sends `question` with the editor's context and any attachment. `kind` is logged: question, explain or review. */
export async function ask(question, kind = 'question') {
  question = question.trim();
  if (!question || busy || !state.workspace) return;
  const attached = takeAttachment();
  const prompt = buildPrompt(question, attached);

  if (chat.querySelector('.empty')) chat.replaceChildren();
  chat.append(h('div', { class: 'msg user' }, question, attached && h('span', { class: 'ctx' }, `Attached: ${attached.label}`)));
  const node = h('div', { class: 'msg tutor' }, h('span', { class: 'thinking' }, 'Thinking…'));
  chat.append(node);
  scrollToEnd();
  current = { node, text: '', revealed: new Set(), streaming: true, activity: null, frame: 0 };
  busy = true;
  setBusy(true);
  try {
    generation = await invoke('tutor_ask', { prompt, kind: attached ? attached.kind : kind });
    emit('usage:changed', await invoke('log_summary'));
  } catch (e) {
    finish({ type: 'error', message: String(e) });
  }
}

function finish(ev) {
  const message = current;
  if (!message) return;
  current = null;
  message.streaming = false;
  cancelAnimationFrame(message.frame);
  message.activity?.remove();
  if (message.text.trim()) renderAnswer(message.node, message.text, message);
  else message.node.remove();
  if (ev.type === 'error') {
    chat.append(h('div', { class: 'msg error' }, ev.message));
    if (/not logged in|\/login|not installed/i.test(ev.message)) recheckAuth();
  } else if (ev.cancelled) chat.append(h('div', { class: 'activity' }, 'Stopped.'));
  busy = false;
  setBusy(false);
  scrollToEnd();
  emit('tutor:finished', { ev, text: message.text });
}

function addText(message, ev) {
  if (ev.type === 'block' && message.text && !message.text.endsWith('\n\n')) message.text += '\n\n';
  if (ev.text) message.text += ev.text;
  if (message.activity) {
    message.activity.remove();
    message.activity = null;
  }
  // Redraw at most once a frame, however fast the text arrives.
  if (message.frame) return;
  message.frame = requestAnimationFrame(() => {
    message.frame = 0;
    if (current !== message) return;
    const pinned = chat.scrollHeight - chat.scrollTop - chat.clientHeight < PINNED_WITHIN_PX;
    if (message.text) renderAnswer(message.node, message.text, message);
    if (pinned) scrollToEnd();
  });
}

function showToolUse(message, ev) {
  const verb = TOOL_VERBS[ev.name] || ev.name;
  const target = String(ev.target || '').replace(state.workspace.path + '/', '');
  if (!message.activity) {
    message.activity = h('div', { class: 'activity' });
    message.node.after(message.activity);
  }
  message.activity.textContent = `${verb} ${target}`;
  scrollToEnd();
}

/** Handles a backend tutor:event for the answer being streamed. */
export function onTutorEvent(ev) {
  if (ev.gen !== generation && generation) return;
  if (!current) return;
  if (ev.type === 'text' || ev.type === 'block') addText(current, ev);
  else if (ev.type === 'tool') showToolUse(current, ev);
  else if (ev.type === 'done' || ev.type === 'error') finish(ev);
}

/** Forgets the conversation, here and in the backend, and stops any answer in progress. */
export async function newConversation() {
  await invoke('tutor_reset');
  if (current) finish({ type: 'done', cancelled: true });
  takeAttachment();
  clearChat();
}

export function setupChat() {
  form.onsubmit = (e) => {
    e.preventDefault();
    const text = input.value;
    if (!text.trim() || busy) return;
    input.value = '';
    ask(text);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
}
