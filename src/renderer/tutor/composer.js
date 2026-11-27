// The question box, with the line above it that says what the tutor will see.

import { h, spacer } from '../dom.js';

const DEFAULT_PLACEHOLDER = 'Ask about a concept, an API, an error, or your own code';

const chip = h('div', { id: 'context-chip' });
export const input = h('textarea', { id: 'input', class: 'text-input', rows: '3', placeholder: DEFAULT_PLACEHOLDER });
export const sendButton = h('button', { type: 'submit', class: 'primary', id: 'send' }, 'Ask');
export const stopButton = h('button', { type: 'button', id: 'stop', hidden: true }, 'Stop');
export const form = h(
  'form',
  { id: 'ask' },
  chip,
  input,
  h('div', { class: 'row' }, h('span', { class: 'dim', id: 'ask-hint' }, 'Enter to send · Shift+Enter for a new line'), spacer(), stopButton, sendButton),
);

/** Something attached to the next question: { kind, label, text, placeholder }. */
let attachment = null;
/** The editor's latest editor:cursor payload. */
let cursor = null;

function renderChip() {
  let text = '';
  if (cursor) {
    text = `Sees: ${cursor.path}`;
    const sel = cursor.selection;
    if (sel) text += sel.fromLine === sel.toLine ? ` · line ${sel.fromLine} selected` : ` · lines ${sel.fromLine}–${sel.toLine} selected`;
  }
  if (attachment) text = text ? `Attached: ${attachment.label} · ${text}` : `Attached: ${attachment.label}`;
  chip.textContent = text;
}

export function showCursor(next) {
  cursor = next;
  renderChip();
}

/** Attaches context to the next question and invites the student to write it. */
export function attach(next) {
  attachment = next;
  input.placeholder = next.placeholder || DEFAULT_PLACEHOLDER;
  input.focus();
  renderChip();
}

/** Removes and returns the attachment, for a question being sent. */
export function takeAttachment() {
  const taken = attachment;
  attachment = null;
  input.placeholder = DEFAULT_PLACEHOLDER;
  renderChip();
  return taken;
}

export function setBusy(busy) {
  sendButton.hidden = busy;
  stopButton.hidden = !busy;
}
