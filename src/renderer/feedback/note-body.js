// The inside of a note in the margin: what the tutor said, the conversation under it, and the
// note's own actions. The editor draws the card around it (its lines, the bar, Hide).

import { h, spacer } from '../dom.js';
import { renderAnswer } from '../tutor/index.js';

/** Puts the cursor back in the code, for Escape inside a note. */
function backToCode(node) {
  node.closest('.cm-editor')?.querySelector('.cm-content')?.focus();
}

/** The status dot for each kind of note; the words say the rest. */
const DOTS = { good: 'success', bug: 'danger', fragile: 'warning' };

/**
 * A note's body. `label` names what it is ("Question", "Explanation"); `remark` (Markdown, may
 * be empty) is what the tutor wrote when the note was made; `thread` is a thread view; `actions`
 * are buttons for the end of the note.
 */
export function noteBody({ kind, label, remark, thread, actions }) {
  const text = remark ? h('div', { class: 'msg tutor fb-remark' }, h('div', { class: 'answer-body' })) : null;
  if (text) renderAnswer(text.firstChild, remark, { revealed: new Set(), streaming: false });
  const node = h(
    'div',
    { class: `fb-note ${kind}` },
    h(
      'div',
      { class: 'fb-note-meta' },
      h('span', { class: 'fb-note-kind' }, kind in DOTS ? h('span', { class: `status-dot ${DOTS[kind]}` }) : null, label),
      spacer(),
      actions,
    ),
    text,
    thread.node,
  );
  node.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    backToCode(node);
  });
  return node;
}

/** A small text button for a note's actions. */
export const noteAction = (label, tip, onclick) => h('button', { type: 'button', class: 'button small ghost fb-action', 'data-tip': tip, onclick }, label);
