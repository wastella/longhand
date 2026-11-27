// A small row of buttons beside a selection, offering the actions other areas registered. It
// waits until the selection has settled and the mouse is up, disappears as soon as the student
// types or moves on, and never takes focus unless asked (Alt+Enter), so typing, copying and
// pasting work as if it were not there.

import { Facet, StateEffect, StateField } from '@codemirror/state';
import { ViewPlugin, showTooltip } from '@codemirror/view';
import { h } from '../dom.js';

// Long enough that dragging or shift-selecting does not flash the buttons; short enough to feel offered.
const SETTLE_MS = 450;

const actions = new Map();

/** Adds an action ({ id, label, run }). Returns a function that removes it. */
export function registerSelectionAction(action) {
  if (!action?.id || !action.label || typeof action.run !== 'function') throw new TypeError('A selection action needs an id, a label and a run function');
  actions.set(action.id, action);
  return () => actions.get(action.id) === action && actions.delete(action.id);
}

/** A function giving the file's current path, which changes when the file is renamed. */
const pathOf = Facet.define({ combine: (values) => values[0] });
const setPopover = StateEffect.define();

const popover = StateField.define({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setPopover)) return effect.value;
    return value && (tr.docChanged || tr.selection) ? null : value;
  },
  provide: (field) => showTooltip.from(field),
});

/** The selected lines and text; a selection ending at the start of a line does not include that line. */
function describeSelection(state) {
  const { from, to } = state.selection.main;
  const last = state.doc.lineAt(to);
  const toLine = last.from === to && to > from ? last.number - 1 : last.number;
  return { fromLine: state.doc.lineAt(from).number, toLine, text: state.sliceDoc(from, to) };
}

function createButtons(view) {
  const run = (action) => {
    const selection = { path: view.state.facet(pathOf)(), ...describeSelection(view.state) };
    view.dispatch({ effects: setPopover.of(null) });
    action.run(selection);
  };
  const buttons = [...actions.values()].map((action) =>
    h('button', { type: 'button', 'data-action': action.id, onmousedown: (e) => e.preventDefault(), onclick: () => run(action) }, action.label),
  );
  const dom = h('div', { class: 'selection-actions', role: 'toolbar', 'aria-label': 'Actions for the selected code' }, buttons);
  dom.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      view.focus();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length].focus();
    }
  });
  return { dom };
}

function popoverFor(state) {
  const { from, head } = state.selection.main;
  return { pos: head, above: head === from, create: createButtons };
}

const canOffer = (state) => actions.size > 0 && !state.selection.main.empty;

/** Shows the popover once the selection has settled and the mouse is up. */
const watcher = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.timer = 0;
      this.pointerDown = false;
      this.down = () => (this.pointerDown = true);
      this.up = () => {
        if (!this.pointerDown) return;
        this.pointerDown = false;
        this.schedule();
      };
      view.contentDOM.addEventListener('mousedown', this.down);
      window.addEventListener('mouseup', this.up);
    }
    update(update) {
      if (update.docChanged || update.selectionSet) this.schedule();
      // Clicking elsewhere in the app leaves the selection in place; the buttons go with the focus.
      if (update.focusChanged && !update.view.hasFocus) this.hideUnlessInside();
    }
    schedule() {
      clearTimeout(this.timer);
      if (this.pointerDown || !canOffer(this.view.state)) return;
      this.timer = setTimeout(() => {
        if (canOffer(this.view.state) && this.view.hasFocus) this.view.dispatch({ effects: setPopover.of(popoverFor(this.view.state)) });
      }, SETTLE_MS);
    }
    hideUnlessInside() {
      clearTimeout(this.timer);
      setTimeout(() => {
        const inside = document.activeElement?.closest('.selection-actions');
        if (!inside && this.view.state.field(popover)) this.view.dispatch({ effects: setPopover.of(null) });
      });
    }
    destroy() {
      clearTimeout(this.timer);
      this.view.contentDOM.removeEventListener('mousedown', this.down);
      window.removeEventListener('mouseup', this.up);
    }
  },
);

/** The extension for one file; `currentPath()` gives the file's path when an action runs. */
export const selectionActions = (currentPath) => [pathOf.of(currentPath), popover, watcher];

/** Alt+Enter: shows the actions for the selection straight away and moves focus to the first. */
export function focusSelectionActions(view) {
  if (!canOffer(view.state)) return false;
  if (!view.state.field(popover)) view.dispatch({ effects: setPopover.of(popoverFor(view.state)) });
  view.dom.querySelector('.selection-actions button')?.focus();
  return true;
}

/** Escape: hides the actions; false when they were not showing. */
export function hideSelectionActions(view) {
  if (!view.state.field(popover)) return false;
  view.dispatch({ effects: setPopover.of(null) });
  return true;
}
