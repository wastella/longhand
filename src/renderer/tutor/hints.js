// "I'm stuck" as a ladder of hints the student climbs one explicit step at a time: orientation,
// then the key idea, then a worked example on an analogous problem. No rung states their code,
// and any rung can be asked for directly; nothing is gated.

import { h, spacer } from '../dom.js';
import { state } from '../state.js';
import { ask } from './conversation.js';
import { input } from './composer.js';

const RUNGS = [
  {
    name: 'Orientation',
    blurb: 'What this part is for and where it fits',
    prompt: (topic) =>
      `I'm stuck${topic}. Give me orientation only: what this part of the assignment is for, where it fits, and what goes in and comes out. Do not describe the steps of a solution.`,
  },
  {
    name: 'Key idea',
    blurb: 'The concept or invariant it rests on',
    prompt: (topic) =>
      `I'm still stuck${topic}. Explain the one key concept or invariant this part depends on, using math, shapes or prose. Do not describe the steps of my code.`,
  },
  {
    name: 'Example',
    blurb: 'The same idea worked through on a different problem',
    prompt: (topic) =>
      `Show me the same idea worked through on an analogous problem in a different setting${topic ? ` (I'm stuck${topic})` : ''}, so I can carry it over myself. It must not be my assignment's code, a translation of it, or a step-by-step recipe for it.`,
  },
];

/** The highest rung asked for since the ladder was opened. */
let reached = 0;
const buttons = RUNGS.map((rung, i) =>
  h(
    'button',
    { class: 'rung', type: 'button', title: rung.blurb, onclick: () => climb(i + 1) },
    h('span', { class: 'rung-step' }, String(i + 1)),
    h('span', { class: 'rung-name' }, rung.name),
  ),
);

export const ladder = h(
  'div',
  { id: 'hints', hidden: true, role: 'group', 'aria-label': 'Hint ladder' },
  h(
    'div',
    { class: 'row' },
    h('span', { class: 'hints-title' }, 'Hints, one step at a time'),
    spacer(),
    h('button', { class: 'ghost', onclick: () => closeLadder() }, 'Close'),
  ),
  h('p', { class: 'dim' }, 'Say what you are stuck on in the box below if you like, then pick a step. None of them writes your code.'),
  h('div', { class: 'rungs' }, buttons),
);

function climb(rung) {
  const topic = input.value.trim();
  const shown = `Hint ${rung} · ${RUNGS[rung - 1].name}${topic ? `: ${topic}` : ''}`;
  if (!ask(RUNGS[rung - 1].prompt(topic ? ` on ${topic}` : ''), 'hint', { shown, rung })) return;
  input.value = '';
  reached = Math.max(reached, rung);
  buttons.forEach((b, i) => {
    b.classList.toggle('reached', i < reached);
    b.setAttribute('aria-pressed', String(i < reached));
  });
}

export function openLadder() {
  if (!state.workspace) return;
  ladder.hidden = false;
  input.focus();
}

export function closeLadder() {
  ladder.hidden = true;
  reached = 0;
  buttons.forEach((b) => (b.classList.remove('reached'), b.setAttribute('aria-pressed', 'false')));
}
