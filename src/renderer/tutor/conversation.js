// The side-panel conversation: one kept thread at a time, its answers streaming in, and earlier
// conversations in this folder reopened from their transcripts.

import { h } from '../dom.js';
import { emit, state } from '../state.js';
import { showStatus } from '../shell/index.js';
import { form, input, setBusy, stopButton, takeContext } from './composer.js';
import { buildPrompt } from './context.js';
import { listThreads, loadThread, tutorRequest } from './engine.js';
import { failureView, needsSetup } from './errors.js';
import { renderAnswer } from './markdown.js';
import { recheckAuth } from './setup.js';

export const CONVERSATION_PREFIX = 'conv-';
export const chat = h('div', { id: 'chat', role: 'log', 'aria-label': 'Conversation with the tutor' });

const TOOL_VERBS = { Read: 'Reading', Grep: 'Searching for', Glob: 'Looking for' };
// Keep following the answer only while the student has not scrolled up to read something else.
const FOLLOW_WITHIN_PX = 60;

/** The kept thread on screen. */
let thread = null;
/** The answer streaming in: { node, body, text, revealed, streaming, frame, activity, handle }. */
let current = null;
let follow = true;

const newThreadId = () => `${CONVERSATION_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
export const currentThread = () => thread;

chat.addEventListener('scroll', () => (follow = chat.scrollHeight - chat.scrollTop - chat.clientHeight < FOLLOW_WITHIN_PX));
function scrollToEnd() {
  chat.scrollTop = chat.scrollHeight;
  follow = true;
}
const keepFollowing = () => follow && (chat.scrollTop = chat.scrollHeight);

function introduction() {
  return h(
    'div',
    { class: 'empty' },
    'Ask about concepts, the math, an error or an API here. The tutor can read this folder but cannot edit files or run anything.',
    h(
      'ul',
      {},
      h(
        'li',
        {},
        'For a review of the open file press ',
        h('kbd', {}, '⇧⌘R'),
        ', or select code and press ',
        h('kbd', {}, '⌘E'),
        ' to have it explained. Both answer in notes in the margin beside your code.',
      ),
      h('li', {}, 'Help with a failing test appears beneath the test.'),
      h('li', {}, 'For a quick fact without leaving the editor, press ', h('kbd', {}, '⇧⌘K'), '.'),
    ),
    'It will not write your assignment.',
  );
}

const note = (text) => h('div', { class: 'note' }, text);
const studentMessage = (text, labels) =>
  h('div', { class: 'msg user' }, text, labels && labels.length ? h('span', { class: 'ctx' }, labels.join(' · ')) : null);

/** The answer as shown, for the clipboard: hidden code stays hidden and formulas become TeX. */
function shownText(body) {
  const clone = body.cloneNode(true);
  clone.querySelectorAll('.withheld').forEach((n) => n.replaceWith('[code hidden by the policy]'));
  clone.querySelectorAll('.katex').forEach((n) => {
    const tex = n.querySelector('annotation')?.textContent;
    const fence = n.closest('.math-display') ? '$$' : '$';
    n.replaceWith(tex ? `${fence}${tex}${fence}` : n.textContent);
  });
  // innerText needs layout to keep paragraphs apart, so measure the copy off screen.
  clone.className = 'copy-scratch msg tutor';
  document.body.append(clone);
  const text = clone.innerText.trim();
  clone.remove();
  return text;
}

function copyButton(body) {
  const button = h('button', { class: 'ghost copy', title: 'Copy this answer as shown' }, 'Copy');
  button.onclick = async () => {
    try {
      await navigator.clipboard.writeText(shownText(body));
      button.textContent = 'Copied';
      setTimeout(() => (button.textContent = 'Copy'), 1500);
    } catch {
      showStatus('Could not copy the answer');
    }
  };
  return button;
}

/** An answer's box. Its actions row is there from the start, so finishing does not shift the layout. */
function answerBox(...content) {
  const body = h('div', { class: 'answer-body' }, ...content);
  const node = h('div', { class: 'msg tutor' }, body, h('div', { class: 'msg-actions' }, copyButton(body)));
  return { node, body };
}

/** A finished answer from `text`, with its Copy button. */
function answer(text) {
  const { node, body } = answerBox();
  renderAnswer(body, text, { revealed: new Set(), streaming: false });
  return node;
}

function scheduleRender(message) {
  message.activity?.remove();
  message.activity = null;
  // Redraw at most once a frame, however fast the text arrives.
  if (message.frame) return;
  message.frame = requestAnimationFrame(() => {
    message.frame = 0;
    if (current !== message) return;
    renderAnswer(message.body, message.text, message);
    keepFollowing();
  });
}

function showToolUse(message, { tool, target }) {
  const path = String(target || '').replace(state.workspace.path + '/', '');
  if (!message.activity) {
    message.activity = h('div', { class: 'activity' });
    message.node.after(message.activity);
  }
  message.activity.textContent = `${TOOL_VERBS[tool] || tool} ${path}`;
  keepFollowing();
}

function finish(message, result, request) {
  if (current === message) current = null;
  message.streaming = false;
  cancelAnimationFrame(message.frame);
  message.activity?.remove();
  message.node.classList.remove('streaming');
  // The student moved to another conversation meanwhile: nothing here is on screen any more.
  const onScreen = message.node.isConnected;
  if (message.text.trim()) renderAnswer(message.body, message.text, message);
  else message.node.remove();
  if (onScreen && result.status === 'error') {
    const view = failureView(result.error, () => {
      if (current || thread !== request.thread) return;
      view.remove();
      send({ ...request, retry: true });
    });
    chat.append(view);
    if (needsSetup(result.error)) recheckAuth();
  } else if (onScreen && result.status === 'cancelled') chat.append(note('Stopped.'));
  setBusy(Boolean(current));
  keepFollowing();
  const ev =
    result.status === 'error'
      ? { type: 'error', message: result.error.message, code: result.error.code }
      : { type: 'done', cancelled: result.status === 'cancelled' };
  emit('tutor:finished', { ev, text: message.text });
}

function send(request) {
  const { node, body } = answerBox(h('span', { class: 'thinking' }, 'Thinking…'));
  node.classList.add('streaming');
  chat.append(node);
  scrollToEnd();
  const message = { node, body, text: '', revealed: new Set(), streaming: true, frame: 0, activity: null };
  current = message;
  setBusy(true);
  message.handle = tutorRequest({
    ...request,
    kind: 'conversation',
    onText: (text) => {
      message.text = text;
      scheduleRender(message);
    },
    onActivity: (activity) => showToolUse(message, activity),
    onRestart: () => node.before(note('The earlier session had expired, so the tutor carries on from this transcript.')),
  });
  message.handle.done.then((result) => finish(message, result, request));
}

/**
 * Sends `question` with the editor's context. Returns false when the question could not be sent
 * (empty, an answer is still coming, or no folder is open).
 */
export function ask(question) {
  question = question.trim();
  if (!question || current || !state.workspace) return false;
  thread ??= newThreadId();
  const { omit } = takeContext();
  const { prompt, labels } = buildPrompt(question, omit);
  if (chat.querySelector('.empty')) chat.replaceChildren();
  chat.append(studentMessage(question, labels));
  send({ thread, prompt, question, context: labels, about: 'question' });
  return true;
}

export const clearChat = () => chat.replaceChildren(introduction());

function stopCurrent() {
  current?.handle.cancel();
}

/** Starts a new conversation, stopping any answer in progress. */
export function newConversation() {
  stopCurrent();
  takeContext();
  thread = newThreadId();
  clearChat();
  input.focus();
}

/** Shows the kept thread `id` and continues it. */
export async function openThread(id) {
  stopCurrent();
  thread = id;
  const saved = await loadThread(id);
  const nodes = [];
  for (const m of saved?.messages || []) {
    if (m.role === 'student') nodes.push(studentMessage(m.text, m.context));
    else if (m.text.trim()) nodes.push(answer(m.text));
    if (m.status === 'stopped') nodes.push(note('Stopped.'));
  }
  if (nodes.length) chat.replaceChildren(...nodes);
  else clearChat();
  scrollToEnd();
}

/** On opening a folder: carry on with its latest conversation, or start one. */
export async function resumeLatest() {
  stopCurrent();
  thread = null;
  const [latest] = await listThreads(CONVERSATION_PREFIX);
  if (latest) await openThread(latest.id);
  else newConversation();
}

export function setupConversation() {
  form.onsubmit = (e) => {
    e.preventDefault();
    if (ask(input.value)) input.value = '';
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  stopButton.onclick = stopCurrent;
}
