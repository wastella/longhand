// Help on a failing test, pinned beneath it in the test panel (registerFailurePanel). Nothing is
// asked until the student engages: first one line, "What did you expect to happen?", with a way
// to skip it. Their answer (or the skip) goes to the tutor with the failure, the test's source and
// the code it exercised, on a thread that stays with the test while it keeps failing. Starter code
// raising NotImplementedError is not a bug: it offers "Where do I start?" instead.
//
// When a test the student asked about passes, one small card asks what was wrong, once. It can
// be skipped with one click and never comes back for that failure.

import { h, spacer } from '../dom.js';
import { state } from '../state.js';
import { registerFailurePanel } from '../tests/index.js';
import { newId } from './notes.js';
import { functionContext } from './source.js';
import { threadView } from './thread-view.js';

const MAX_REPORT_CHARS = 6000;
const LOOK = 'Help me work out where this goes wrong.';

/** node -> { test, thread, view, engaged, answered, changed, marker, start } */
const panels = new WeakMap();

const testName = (test) => test.id.split('::').pop();
const notWritten = (test) => /^\s*NotImplementedError\b/.test(test.message || '');
const report = (test) => [test.message, test.detail].filter(Boolean).join('\n\n').slice(0, MAX_REPORT_CHARS);

/** What the tutor is told about the failure: the report, the test, and the code it ran. */
async function failureContext(test) {
  const parts = [
    `Failing test: ${test.id} (${test.status}${test.phase && test.phase !== 'call' ? `, during ${test.phase}` : ''})`,
    `Pytest's report:\n${report(test)}`,
  ];
  if (test.path && test.line) parts.push(await functionContext(test.path, test.line, 'The test'));
  const seen = new Set([test.path]);
  for (const frame of [...(test.frames || [])].reverse()) {
    if (!frame.own || !frame.rel || seen.has(frame.rel) || seen.size > 2) continue;
    seen.add(frame.rel);
    parts.push(await functionContext(frame.rel, frame.line, 'Code under test'));
  }
  return parts.filter(Boolean).join('\n\n');
}

const sees = (panel) => `${testName(panel.test)}'s failure, the test's code and the code it ran, and your words`;

async function firstRequest(panel, question, shown) {
  return {
    prompt: `<context>\n${await failureContext(panel.test)}\n</context>\n\n${question}`,
    question: shown,
    context: [testName(panel.test)],
    about: 'failure',
  };
}

async function replyRequest(panel, text) {
  let prompt = text;
  if (panel.changed) {
    prompt = `<context>\nThe failure changed since my last message. Now:\n${report(panel.test)}\n</context>\n\n${text}`;
    panel.changed = false;
    panel.marker.hidden = true;
  }
  return { prompt, question: text, context: [testName(panel.test)], about: 'failure' };
}

/** The student engaged: the opening line goes, the conversation starts. */
async function begin(panel, question, shown) {
  panel.engaged = true;
  panel.start.remove();
  panel.view.node.hidden = false;
  panel.view.ask(await firstRequest(panel, question, shown));
}

/** The opening line: "What did you expect?", or "Where do I start?" for starter code. */
function opening(panel) {
  if (notWritten(panel.test)) {
    return h(
      'div',
      { class: 'fb-start' },
      h(
        'button',
        {
          type: 'button',
          class: 'button small fb-where',
          onclick: () => begin(panel, 'Where do I start? This test fails with NotImplementedError from the starter code.', 'Where do I start?'),
        },
        'Where do I start?',
      ),
      h('span', { class: 'dim' }, 'What this function is for, what the test checks, and what to read first.'),
    );
  }
  const input = h('input', {
    type: 'text',
    class: 'text-input fb-expect',
    placeholder: 'What did you expect to happen?',
    'aria-label': `What did you expect ${testName(panel.test)} to do?`,
    autocomplete: 'off',
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || !input.value.trim()) return;
    e.preventDefault();
    const expected = input.value.trim();
    begin(panel, `I expected: ${expected}\n\n${LOOK}`, `Expected: ${expected}`);
  });
  const skip = h(
    'button',
    {
      type: 'button',
      class: 'button small ghost fb-skip',
      'data-tip': 'Ask the tutor without saying what you expected',
      onclick: () => begin(panel, LOOK, 'Where should I look?'),
    },
    'Skip and ask',
  );
  return h('div', { class: 'fb-start' }, input, skip);
}

function render(test) {
  if (!state.workspace) return null;
  const panel = { test, engaged: false, answered: false, changed: false, thread: `fail-${newId('')}` };
  panel.view = threadView({
    thread: panel.thread,
    kind: 'failure',
    placeholder: 'Reply…',
    label: `Reply about ${testName(test)}`,
    sees: () => sees(panel),
    reply: (text) => replyRequest(panel, text),
    onAnswer: (result) => (panel.answered ||= result.status === 'done'),
  });
  panel.view.node.hidden = true;
  panel.marker = h('span', { class: 'fb-changed', hidden: true, 'data-tip': 'Your next message sends the new output' }, 'The failure changed since you asked');
  panel.start = opening(panel);
  const node = h(
    'div',
    { class: 'fb-failure' },
    h('div', { class: 'fb-failure-head' }, h('h3', { class: 'section-label' }, 'Tutor'), spacer(), panel.marker),
    panel.start,
    panel.view.node,
  );
  panels.set(node, panel);
  return node;
}

function update(test, node) {
  const panel = panels.get(node);
  if (!panel) return;
  panel.test = test;
  if (panel.engaged) {
    panel.changed = true;
    panel.marker.hidden = false;
    return;
  }
  // Not asked about yet: the opening line follows the failure (starter code may now be written).
  const fresh = opening(panel);
  panel.start.replaceWith(fresh);
  panel.start = fresh;
}

/** The checkpoint once a test the student asked about passes: one sentence, one short reply. */
function checkpoint(panel, test) {
  const view = threadView({ thread: panel.thread, kind: 'failure' });
  const input = h('input', {
    type: 'text',
    class: 'text-input fb-expect',
    placeholder: 'It was…',
    'aria-label': 'In a sentence, what was wrong?',
    autocomplete: 'off',
  });
  const close = h('button', { type: 'button', class: 'button small ghost fb-action', onclick: () => (card.hidden = true) }, 'Close');
  close.hidden = true;
  const skip = h(
    'button',
    { type: 'button', class: 'button small ghost fb-skip', 'data-tip': 'Skip this; it will not ask again', onclick: () => (card.hidden = true) },
    'Skip',
  );
  const ask = h('div', { class: 'fb-start' }, input, skip);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || !input.value.trim()) return;
    e.preventDefault();
    const said = input.value.trim();
    ask.remove();
    view
      .ask({
        prompt: `<context>\nThe test ${test.id} passes now.\n</context>\n\nThe test passes now. What I think was wrong: ${said}\n\nIn one or two sentences, confirm or sharpen my explanation.`,
        question: said,
        context: [testName(test)],
        about: 'checkpoint',
      })
      .then(() => (close.hidden = false));
  });
  const card = h(
    'div',
    { class: 'fb-checkpoint' },
    h('div', { class: 'fb-failure-head' }, h('span', { class: 'fb-checkpoint-title' }, 'That passes now. In a sentence, what was wrong?'), spacer(), close),
    ask,
    view.node,
  );
  return card;
}

function dispose(test, node) {
  const panel = panels.get(node);
  if (!panel) return null;
  panel.view.stop();
  panels.delete(node);
  return test.status === 'PASSED' && panel.answered ? checkpoint(panel, test) : null;
}

/** Attaches the help beneath failing tests. Returns the function that removes it. */
export function setupFailureHelp() {
  return registerFailurePanel(render, dispose, update);
}
