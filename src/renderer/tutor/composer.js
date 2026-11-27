// The question box, with the row above it that shows what the tutor will see with the next
// question. Each item there can be removed for that question.

import { h, spacer } from '../dom.js';
import { contextItems } from './context.js';

const DEFAULT_PLACEHOLDER = 'Ask about a concept, an API, an error, or your own code';

const chips = h('div', { id: 'context-chips', 'aria-label': 'What the tutor sees with your next question' });
export const input = h('textarea', { id: 'input', class: 'text-input', rows: '3', placeholder: DEFAULT_PLACEHOLDER, 'aria-label': 'Question for the tutor' });
export const sendButton = h('button', { type: 'submit', class: 'primary', id: 'send' }, 'Ask');
export const stopButton = h('button', { type: 'button', id: 'stop', hidden: true }, 'Stop');
export const form = h(
  'form',
  { id: 'ask' },
  chips,
  input,
  h('div', { class: 'row' }, h('span', { class: 'dim', id: 'ask-hint' }, 'Enter to send · Shift+Enter for a new line'), spacer(), stopButton, sendButton),
);

/** Something attached to the next question: { kind, label, text, placeholder }. */
let attachment = null;
/** Context the student removed from the next question: 'file', 'selection', 'attachment'. */
const omit = new Set();
let lastPath = null;
let lastSelection = null;

export function renderChips() {
  const items = contextItems(attachment, omit);
  chips.replaceChildren(
    h('span', { class: 'sees' }, items.length ? 'Sees' : 'Sees only your question'),
    ...items.map((item) =>
      h(
        'span',
        { class: `chip ${item.key}`, title: item.title },
        h('span', { class: 'chip-label' }, item.label),
        h(
          'button',
          {
            class: 'chip-remove',
            type: 'button',
            'aria-label': `Leave out ${item.label}`,
            title: 'Leave out of the next question',
            onclick: () => remove(item.key),
          },
          '×',
        ),
      ),
    ),
  );
}

function remove(key) {
  if (key === 'attachment') {
    attachment = null;
    input.placeholder = DEFAULT_PLACEHOLDER;
  } else omit.add(key);
  if (key === 'file') omit.add('selection');
  renderChips();
  input.focus();
}

/** Follows the editor (an editor:cursor payload): a new file or selection is shown again. */
export function showCursor(cursor) {
  const path = cursor ? cursor.path : null;
  const selection = cursor?.selection ? `${cursor.selection.fromLine}-${cursor.selection.toLine}` : null;
  if (path !== lastPath) omit.delete('file');
  if (path !== lastPath || selection !== lastSelection) omit.delete('selection');
  lastPath = path;
  lastSelection = selection;
  renderChips();
}

/** Attaches context to the next question and invites the student to write it. */
export function attach(next) {
  attachment = next;
  omit.delete('attachment');
  input.placeholder = next.placeholder || DEFAULT_PLACEHOLDER;
  input.focus();
  renderChips();
}

/** Takes what the next question carries: { attachment, omit }. Removed items come back afterwards. */
export function takeContext() {
  const taken = { attachment, omit: new Set(omit) };
  attachment = null;
  omit.clear();
  input.placeholder = DEFAULT_PLACEHOLDER;
  renderChips();
  return taken;
}

export function setBusy(busy) {
  sendButton.hidden = busy;
  stopButton.hidden = !busy;
}
