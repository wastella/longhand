// Go to line (Ctrl+G): a one-field panel at the top of the editor. Takes "42" or "42:7".

import { StateEffect, StateField } from '@codemirror/state';
import { EditorView, getPanel, showPanel } from '@codemirror/view';
import { h } from '../dom.js';
import { icon } from '../shell/icons.js';

const setOpen = StateEffect.define();

const isOpen = StateField.define({
  create: () => false,
  update: (open, tr) => tr.effects.reduce((value, e) => (e.is(setOpen) ? e.value : value), open),
  provide: (field) => showPanel.from(field, (open) => (open ? createPanel : null)),
});

/** Moves the cursor to `line` (and `column`), clamped to the file, and centres it. */
export function goTo(view, line, column = 1) {
  const { doc } = view.state;
  const target = doc.line(Math.max(1, Math.min(line, doc.lines)));
  const pos = Math.min(target.from + Math.max(0, column - 1), target.to);
  view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
}

function close(view) {
  view.dispatch({ effects: setOpen.of(false) });
  view.focus();
}

function createPanel(view) {
  const field = h('input', {
    class: 'text-input search-field go-to-field',
    inputmode: 'numeric',
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-label': 'Line number',
    placeholder: 'Line',
  });
  const hint = h('span', { class: 'search-count' });
  const showRange = () => (hint.textContent = `1 to ${view.state.doc.lines}, or line:column`);
  showRange();
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return (e.preventDefault(), close(view));
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const match = /^\s*(\d+)\s*(?:[:,]\s*(\d+))?\s*$/.exec(field.value);
    if (!match) return hint.classList.add('bad');
    close(view);
    goTo(view, Number(match[1]), Number(match[2] || 1));
  });
  field.addEventListener('input', () => hint.classList.remove('bad'));
  const dom = h(
    'div',
    { class: 'search-panel go-to-panel' },
    h(
      'div',
      { class: 'search-row' },
      h('label', { class: 'search-label' }, 'Go to line'),
      field,
      hint,
      h('button', { class: 'ghost', type: 'button', 'aria-label': 'Close (Esc)', title: 'Close (Esc)', onclick: () => close(view) }, icon('x', 'small')),
    ),
  );
  return { dom, top: true, mount: () => field.focus(), update: showRange };
}

/** The extension that makes the panel available. */
export const goToLinePanel = isOpen;

/** Opens the panel, or returns focus to it when it is already open. */
export function openGoToLine(view) {
  if (view.state.field(isOpen)) getPanel(view, createPanel)?.dom.querySelector('input').focus();
  else view.dispatch({ effects: setOpen.of(true) });
  return true;
}
