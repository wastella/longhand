// The modal sheet (.sheet in base.css): one at a time, closed with Escape, the close button or a
// click outside. While it is open the rest of the app is inert, so neither Tab nor a shortcut
// such as ⌘1 can move focus behind it.

import { h, spacer } from '../dom.js';
import { icon } from './icons.js';

const FOCUSABLE = 'button, select, input, textarea, [href], [tabindex]:not([tabindex="-1"])';
let current = null;
let nextId = 0;

/** Whether a sheet is open. */
export const isSheetOpen = () => current !== null;

/** Makes everything but `keep` inert; returns a function that restores what was there before. */
function isolate(keep) {
  const others = [...document.body.children].filter((node) => node !== keep && !node.inert);
  for (const node of others) node.inert = true;
  return () => others.forEach((node) => (node.inert = false));
}

/**
 * Opens a sheet titled `title` around `body` (nodes), with an optional `footer`. `className`
 * is added to the sheet; `onClose` runs once it closes. Returns { close, element }.
 * The sheet itself takes focus, so no control shows a focus ring until Tab reaches it; focus
 * returns where it was on close.
 */
export function openSheet({ title, body, footer, className = '', onClose }) {
  current?.close();
  const returnFocus = document.activeElement;
  const titleId = `sheet-title-${++nextId}`;
  const closeButton = h('button', { class: 'button ghost icon-button', 'aria-label': 'Close', 'data-tip': 'Close', onclick: () => close() }, icon('x'));
  const element = h(
    'div',
    { class: `sheet ${className}`.trim(), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    h('header', { class: 'sheet-head' }, h('h2', { id: titleId }, title), spacer(), closeButton),
    h('div', { class: 'sheet-body' }, body),
    footer && h('footer', { class: 'sheet-foot' }, footer),
  );
  const backdrop = h('div', { class: 'sheet-backdrop', onmousedown: (e) => e.target === backdrop && close() }, element);

  // Tab and Shift+Tab cycle through the sheet's controls, starting from the sheet itself.
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      const stops = [...element.querySelectorAll(FOCUSABLE)].filter((node) => !node.disabled && node.offsetParent);
      const active = document.activeElement;
      const onStop = stops.includes(active);
      const atEdge = e.shiftKey ? active === stops[0] : active === stops.at(-1);
      if (!onStop || atEdge) {
        e.preventDefault();
        (e.shiftKey ? stops.at(-1) : stops[0])?.focus();
      }
    }
  }

  const restore = isolate(backdrop);
  function close() {
    if (current?.element !== element) return;
    current = null;
    backdrop.remove();
    restore();
    document.removeEventListener('keydown', onKey, true);
    if (returnFocus?.isConnected) returnFocus.focus();
    onClose?.();
  }

  document.addEventListener('keydown', onKey, true);
  document.body.append(backdrop);
  element.focus();
  current = { close, element };
  return current;
}
