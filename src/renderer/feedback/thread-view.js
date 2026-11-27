// A short conversation with the tutor pinned to the student's work: under a margin note, an
// explanation or a failing test. It is the side panel's conversation in miniature, with the same
// parts: the student's words, the tutor's answers through renderAnswer (so math, code colours and
// the hidden-code check apply), what the tutor is reading, Stop while it answers, and errors in
// place with Retry. It asks nothing on its own: every request starts from something the student
// did.

import { h } from '../dom.js';
import { state } from '../state.js';
import { failureView, loadThread, renderAnswer, tutorRequest } from '../tutor/index.js';

const TOOL_VERBS = { Read: 'Reading', Grep: 'Searching for', Glob: 'Looking for' };

/**
 * Makes a thread view. Options:
 *   thread         the tutor thread id
 *   kind           the request kind ('review' or 'failure')
 *   placeholder    the reply box's placeholder; no reply box when omitted
 *   label          the reply box's accessible name
 *   sees()         what the tutor sees with a reply, as a short phrase ("lines 12–14 of running.py")
 *   reply(text)    turns a reply into a request: { prompt, question, context, about }
 *   onAnswer()     a request ended (done, stopped or failed)
 * Returns { node, input, ask(request), restore(), stop(), busy() }, where `request` is
 * { prompt, question?, context?, about }. A question of null is left out of the view.
 */
export function threadView({ thread, kind, placeholder, label, sees, reply, onAnswer = () => {} }) {
  const messages = h('div', { class: 'fb-messages' });
  const node = h('div', { class: 'fb-thread' }, messages);
  let current = null;
  let preparing = false;

  let input = null;
  if (placeholder) {
    input = h('input', { type: 'text', class: 'text-input fb-reply-input', placeholder, 'aria-label': label || placeholder, autocomplete: 'off' });
    const seesLine = h('div', { class: 'fb-sees' });
    const refreshSees = () => (seesLine.textContent = `The tutor sees ${sees()}.`);
    input.addEventListener('focus', refreshSees);
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || !input.value.trim() || current || preparing) return;
      e.preventDefault();
      const text = input.value.trim();
      input.value = '';
      preparing = true;
      Promise.resolve(reply(text))
        .then(ask)
        .finally(() => (preparing = false));
    });
    node.append(h('div', { class: 'fb-reply' }, input, seesLine));
  }

  const studentMessage = (text) => h('div', { class: 'msg user' }, text);

  function answerNode(text) {
    const body = h('div', { class: 'answer-body' });
    renderAnswer(body, text, { revealed: new Set(), streaming: false });
    return h('div', { class: 'msg tutor' }, body);
  }

  function send(request) {
    const body = h('div', { class: 'answer-body' }, h('span', { class: 'thinking' }, 'Thinking…'));
    const stopButton = h('button', { type: 'button', class: 'ghost fb-stop', onclick: () => stop() }, 'Stop');
    const activity = h('div', { class: 'activity', hidden: true });
    const box = h('div', { class: 'msg tutor streaming' }, body, activity, h('div', { class: 'fb-running' }, stopButton));
    messages.append(box);
    const message = { revealed: new Set(), streaming: true, text: '', frame: 0 };
    const draw = () => {
      message.frame = 0;
      if (message.text) renderAnswer(body, message.text, message);
    };
    const handle = tutorRequest({
      thread,
      kind,
      ...request,
      onText: (text) => {
        message.text = text;
        activity.hidden = true;
        message.frame ||= requestAnimationFrame(draw);
      },
      onActivity: ({ tool, target }) => {
        activity.hidden = false;
        activity.textContent = `${TOOL_VERBS[tool] || tool} ${String(target || '').replace(`${state.workspace?.path}/`, '')}`;
      },
    });
    current = handle;
    handle.done.then((result) => {
      if (current === handle) current = null;
      cancelAnimationFrame(message.frame);
      message.streaming = false;
      box.classList.remove('streaming');
      activity.remove();
      box.querySelector('.fb-running').remove();
      if (message.text.trim()) renderAnswer(body, message.text, message);
      else box.remove();
      if (result.status === 'error') {
        const view = failureView(result.error, () => {
          if (current) return;
          view.remove();
          send({ ...request, retry: true });
        });
        messages.append(view);
      } else if (result.status === 'cancelled') messages.append(h('div', { class: 'note' }, 'Stopped.'));
      onAnswer(result);
    });
    return handle.done;
  }

  /** Asks `request` on the thread. Resolves with the engine's result. */
  function ask(request) {
    if (request.question) messages.append(studentMessage(request.question));
    return send(request);
  }

  /** Shows what the thread holds from earlier sessions. */
  async function restore() {
    const saved = await loadThread(thread);
    const shown = (saved?.messages || []).filter((m) => m.text.trim());
    messages.prepend(...shown.map((m) => (m.role === 'student' ? studentMessage(m.text) : answerNode(m.text))));
  }

  const stop = () => current?.cancel();
  return { node, input, ask, restore, stop, busy: () => Boolean(current) };
}
