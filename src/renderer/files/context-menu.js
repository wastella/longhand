import { h } from '../dom.js';

/** Opens a menu at the pointer. `items` are { label, run } objects, with null for a separator. */
export function showContextMenu(event, items) {
  closeContextMenus();
  const menu = h(
    'div',
    { class: 'ctx-menu' },
    items.map((item) => (item ? h('div', { class: 'ctx-item', onclick: () => (closeContextMenus(), item.run()) }, item.label) : h('hr'))),
  );
  document.body.append(menu);
  menu.style.left = Math.min(event.clientX, innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = Math.min(event.clientY, innerHeight - menu.offsetHeight - 8) + 'px';
}

export function closeContextMenus() {
  for (const menu of document.querySelectorAll('.ctx-menu')) menu.remove();
}
