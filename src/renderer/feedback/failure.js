// Help on a failing test, pinned beneath it in the test panel (registerFailurePanel). Nothing is
// asked until the student engages: first one line, "What did you expect to happen?", with a way
// to skip it. Their answer (or the skip) goes to the tutor with the failure, the test's source and
// the code it exercised, on a thread that stays with the test while it keeps failing. Starter code
// raising NotImplementedError is not a bug: it offers "Where do I start?" instead.
//
// When a test the student asked about passes, one small card asks what was wrong (or, after
// "Where do I start?", what the function does now), once. It can be skipped with one click and
// never comes back for that failure. An answer still arriving when the test passes is let finish;
// the card follows it.
//
// The answers in one panel, the checkpoint's included, are checked for code together.

import { h, spacer } from '../dom.js';
import { state } from '../state.js';
import { registerFailurePanel } from '../tests/index.js';
import { codeGroup } from './code-group.js';
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
          onclick: () => {
            panel.starting = true;
            begin(panel, 'Where do I start? This test fails with NotImplementedError from the starter code.', 'Where do I start?');
          },
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
  const panel = {
    test,
    engaged: false,
    answered: false,
    changed: false,
    starting: false,
    thread: `fail-${newId('')}`,
    group: codeGroup('the answers about this test'),
  };
  panel.view = threadView({
    group: panel.group,
    thread: panel.thread,
    kind: 'failure',
    placeholder: 'Reply…',
    label: `Reply about ${testName(test)}`,
    sees: () => sees(panel),
    reply: (text) => replyRequest(panel, text),
    onAnswer: (result) => {
      panel.answered ||= result.status === 'done';
      panel.afterAnswer?.();
    },
  });
  panel.view.node.hidden = true;
  panel.marker = h('span', { class: 'fb-changed', hidden: true, 'data-tip': 'Your next message sends the new output' }, 'The failure changed since you asked');
  panel.start = opening(panel);
  panel.startsAs = notWritten(test);
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
  // Not asked about yet: the opening line follows the failure when starter code has since been
  // written (or put back). Otherwise it stays as it is, with anything the student is typing.
  if (notWritten(test) === panel.startsAs) return;
  const fresh = opening(panel);
  panel.start.replaceWith(fresh);
  panel.start = fresh;
  panel.startsAs = notWritten(test);
}

/**
 * The checkpoint once a test the student asked about passes: one sentence, one short reply. After
 * a "Where do I start?" conversation nothing was wrong, so it asks what the function does now.
 */
function checkpoint(panel, test) {
  const view = threadView({ thread: panel.thread, kind: 'failure', group: panel.group });
  const question = panel.starting ? 'That passes now. In a sentence, what does this function do now?' : 'That passes now. In a sentence, what was wrong?';
  const input = h('input', {
    type: 'text',
    class: 'text-input fb-expect',
    placeholder: panel.starting ? 'It…' : 'It was…',
    'aria-label': question.replace('That passes now. ', ''),
    autocomplete: 'off',
  });
  const hide = () => {
    view.stop();
    card.hidden = true;
  };
  const close = h('button', { type: 'button', class: 'button small ghost fb-action', onclick: hide }, 'Close');
  close.hidden = true;
  const skip = h('button', { type: 'button', class: 'button small ghost fb-skip', 'data-tip': 'Skip this; it will not ask again', onclick: hide }, 'Skip');
  const ask = h('div', { class: 'fb-start' }, input, skip);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || !input.value.trim()) return;
    e.preventDefault();
    const said = input.value.trim();
    ask.remove();
    view
      .ask({
        prompt: panel.starting
          ? `<context>\nThe test ${test.id} passes now.\n</context>\n\nThe test passes now. What I think the function does now: ${said}\n\nIn one or two sentences, confirm or sharpen my description.`
          : `<context>\nThe test ${test.id} passes now.\n</context>\n\nThe test passes now. What I think was wrong: ${said}\n\nIn one or two sentences, confirm or sharpen my explanation.`,
        question: said,
        context: [testName(test)],
        about: 'checkpoint',
      })
      .then(() => (close.hidden = false));
  });
  const card = h(
    'div',
    { class: 'fb-checkpoint' },
    h('div', { class: 'fb-failure-head' }, h('span', { class: 'fb-checkpoint-title' }, question), spacer(), close),
    ask,
    view.node,
  );
  // The tests area let go of the card (the next run, another folder): its reply stops.
  card.addEventListener('panel-removed', () => view.stop());
  return card;
}

function dispose(test, node) {
  const panel = panels.get(node);
  if (!panel) return null;
  panels.delete(node);
  if (test.status !== 'PASSED') {
    panel.view.stop();
    return null;
  }
  if (!panel.view.busy()) return panel.answered ? checkpoint(panel, test) : null;
  // An answer is still arriving: it finishes beneath the passing test, then the checkpoint follows.
  panel.marker.hidden = true;
  panel.view.node.querySelector('.fb-reply')?.remove();
  const holder = h('div', { class: 'fb-parting' }, node);
  panel.afterAnswer = () => {
    panel.afterAnswer = null;
    if (panel.answered) holder.append(checkpoint(panel, test));
  };
  holder.addEventListener('panel-removed', () => {
    panel.afterAnswer = null;
    panel.view.stop();
    holder.querySelector('.fb-checkpoint')?.dispatchEvent(new Event('panel-removed'));
  });
  return holder;
}

/** Attaches the help beneath failing tests. Returns the function that removes it. */
export function setupFailureHelp() {
  return registerFailurePanel(render, dispose, update);
}
