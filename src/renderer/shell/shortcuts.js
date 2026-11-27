// The keyboard shortcuts. The table comes from the menu bar itself (menu.rs records every item
// with keys), so the reference sheet and tooltips cannot drift from the menu.

import { invoke } from '../backend.js';
import { h } from '../dom.js';
import { registerCommand } from './commands.js';
import { formatKeys, kbd } from './keys.js';
import { openSheet } from './sheet.js';

/** [{ id, menu, label, keys }] in menu order. */
let table = [];

export async function loadShortcuts() {
  try {
    table = (await invoke('shortcuts_list')) || [];
  } catch {
    // Without the table, tooltips simply show no keys and the reference says so.
    table = [];
  }
}

/** The keys of the menu command `id`, such as "CmdOrCtrl+B", or undefined. */
export const keysFor = (id) => table.find((shortcut) => shortcut.id === id)?.keys;

/** `text` followed by the command's shortcut, for a plain-text tooltip: "Find in files (⇧⌘F)". */
export function withKeys(text, id) {
  const keys = keysFor(id);
  return keys ? `${text} (${formatKeys(keys)})` : text;
}

/** Menus too small for a group of their own in the reference, and where they go instead. */
const GROUPS = { Window: 'Longhand' };

function showShortcuts() {
  // Map.groupBy would do this, but the macOS 12 webview predates it.
  const menus = new Map();
  for (const shortcut of table) {
    const group = GROUPS[shortcut.menu] || shortcut.menu;
    menus.set(group, [...(menus.get(group) || []), shortcut]);
  }
  const body = menus.size
    ? [...menus].map(([menu, shortcuts]) =>
        h(
          'section',
          { class: 'shortcut-group' },
          h('h3', { class: 'section-label' }, menu),
          h('dl', {}, ...shortcuts.map((s) => h('div', { class: 'shortcut' }, h('dt', {}, s.label), h('dd', {}, kbd(s.keys))))),
        ),
      )
    : h('p', { class: 'empty-state' }, 'The shortcut list could not be loaded. Every shortcut is also shown in the menus.');
  openSheet({ title: 'Keyboard Shortcuts', body: h('div', { class: 'shortcut-list' }, body), className: 'shortcuts-sheet' });
}

export function mountShortcuts() {
  registerCommand('shortcuts', showShortcuts);
}
