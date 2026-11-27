// A menu that floats at the pointer (or under a row, when opened from the keyboard). Arrow
// keys move through it, Enter picks, Escape closes and gives the focus back.

import { h } from '../dom.js';
import { closeOnEscape } from '../shell/dismiss.js';

let returnFocus = null;

closeOnEscape(
  () => document.querySelector('.ctx-menu') !== null,
  () => closeContextMenus({ restoreFocus: true }),
);

/**
 * Opens a menu at { x, y }. `items` are { label, hint?, run } objects, with null for a separator.
 * `fromKeyboard` highlights the first item, as native menus do.
 */
export function showContextMenu({ x, y }, items, { fromKeyboard = false } = {}) {
  closeContextMenus();
  returnFocus = document.activeElement;
  const entries = [];
  const pick = (item) => {
    closeContextMenus();
    item.run();
  };
  const menu = h(
    'div',
    { class: 'ctx-menu', role: 'menu', tabindex: '-1' },
    items.map((item) => {
      if (!item) return h('hr');
      const node = h(
        'div',
        { class: 'ctx-item', role: 'menuitem', onclick: () => pick(item), onmousemove: () => highlight(entries.indexOf(node)) },
        h('span', { class: 'ctx-label' }, item.label),
        item.hint && h('span', { class: 'ctx-hint' }, item.hint),
      );
      entries.push(node);
      return node;
    }),
  );
  let current = -1;
  const highlight = (i) => {
    current = (i + entries.length) % entries.length;
    entries.forEach((node, j) => node.classList.toggle('active', j === current));
  };
  menu.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'ArrowDown') highlight(current + 1);
    else if (e.key === 'ArrowUp') highlight(current < 0 ? -1 : current - 1);
    else if ((e.key === 'Enter' || e.key === ' ') && current >= 0) pick(items.filter(Boolean)[current]);
    else if (e.key === 'Tab') closeContextMenus({ restoreFocus: true });
  });
  document.body.append(menu);
  menu.style.left = Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + 'px';
  menu.focus();
  if (fromKeyboard) highlight(0);
}

export function closeContextMenus({ restoreFocus = false } = {}) {
  const open = document.querySelectorAll('.ctx-menu');
  for (const menu of open) menu.remove();
  // Picking an item gives the focus back too, so the action starts from where the student was.
  if (open.length && returnFocus?.isConnected && (restoreFocus || document.activeElement === document.body)) returnFocus.focus();
  returnFocus = null;
}
