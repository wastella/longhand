// Keyboard shortcuts as people read them. Shortcuts are written the way menu.rs gives them to
// Tauri ("CmdOrCtrl+Shift+F") and drawn here with the Mac's symbols: "⇧⌘F".

import { h } from '../dom.js';

// macOS orders modifier symbols Control, Option, Shift, Command.
const MODIFIERS = [
  ['ctrl', '⌃'],
  ['alt', '⌥'],
  ['shift', '⇧'],
  ['cmd', '⌘'],
];
const KEY_NAMES = { enter: '↩', return: '↩', escape: 'Esc', esc: 'Esc', backspace: '⌫', tab: '⇥', space: 'Space', up: '↑', down: '↓', left: '←', right: '→' };

function parse(keys) {
  const parts = keys.split('+').map((part) => part.trim());
  // A shortcut on the plus key itself ends in "++".
  const key = parts.pop() || '+';
  const mods = new Set(
    parts.map((mod) => {
      const lower = mod.toLowerCase();
      if (lower === 'cmdorctrl' || lower === 'commandorcontrol') return 'cmd';
      if (lower === 'command' || lower === 'super' || lower === 'meta') return 'cmd';
      if (lower === 'control') return 'ctrl';
      if (lower === 'option') return 'alt';
      return lower;
    }),
  );
  return { mods, key: KEY_NAMES[key.toLowerCase()] || (key.length === 1 ? key.toUpperCase() : key) };
}

/** "CmdOrCtrl+Shift+F" as a Mac writes it: "⇧⌘F". */
export function formatKeys(keys) {
  const { mods, key } = parse(keys);
  return (
    MODIFIERS.filter(([mod]) => mods.has(mod))
      .map(([, symbol]) => symbol)
      .join('') + key
  );
}

/** A key cap showing `keys` (see .kbd in base.css). */
export const kbd = (keys) => h('kbd', { class: 'kbd' }, formatKeys(keys));
