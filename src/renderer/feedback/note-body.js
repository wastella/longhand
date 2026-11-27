// The parts of a note in the margin. The editor draws the card (its lines, the bar, Hide); this
// area gives it a head (what kind of note it is), actions for the card's top row, and a body:
// what the tutor said and the conversation under it.

import { h } from '../dom.js';

/** Puts the cursor back in the code, for Escape inside a note. */
function backToCode(node) {
  node.closest('.cm-editor')?.querySelector('.cm-content')?.focus();
}

/** The status dot for each kind of note; the words say the rest. */
const DOTS = { good: 'success', bug: 'danger', fragile: 'warning' };

/** What kind of note it is, for the card's top row: a dot and a label. */
export const noteHead = (kind, label) => h('span', { class: 'fb-note-kind' }, kind in DOTS ? h('span', { class: `status-dot ${DOTS[kind]}` }) : null, label);

/**
 * A note's body. `remark` is a node holding what the tutor wrote when the note was made (rendered
 * by the caller's code group), or null; `thread` is a thread view.
 */
export function noteBody({ kind, remark, thread }) {
  const node = h('div', { class: `fb-note ${kind}` }, remark ? h('div', { class: 'msg tutor fb-remark' }, remark) : null, thread.node);
  node.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    backToCode(node);
  });
  return node;
}

/** A small text button for a note's actions. */
export const noteAction = (label, tip, onclick, aria) =>
  h('button', { type: 'button', class: 'button small ghost fb-action', 'data-tip': tip, 'aria-label': aria || null, onclick }, label);
