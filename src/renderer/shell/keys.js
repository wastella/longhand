// Keyboard shortcuts as people read them. Shortcuts are written the way menu.rs gives them to
// Tauri ("CmdOrCtrl+Shift+F") and drawn here: "⇧⌘F" on a Mac, "Ctrl+Shift+F" elsewhere.

import { h } from '../dom.js';

const isMac = /Mac/.test(navigator.platform);

// macOS orders modifier symbols Control, Option, Shift, Command.
const MAC_MODIFIERS = [
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
      if (lower === 'cmdorctrl' || lower === 'commandorcontrol') return isMac ? 'cmd' : 'ctrl';
      if (lower === 'command' || lower === 'super' || lower === 'meta') return 'cmd';
      if (lower === 'control') return 'ctrl';
      if (lower === 'option') return 'alt';
      return lower;
    }),
  );
  return { mods, key: KEY_NAMES[key.toLowerCase()] || (key.length === 1 ? key.toUpperCase() : key) };
}

/** "CmdOrCtrl+Shift+F" as the platform writes it: "⇧⌘F" on a Mac, "Ctrl+Shift+F" elsewhere. */
export function formatKeys(keys) {
  const { mods, key } = parse(keys);
  if (isMac) {
    const symbols = MAC_MODIFIERS.filter(([mod]) => mods.has(mod)).map(([, symbol]) => symbol);
    return symbols.join('') + key;
  }
  const names = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', cmd: 'Win' };
  return [...['ctrl', 'alt', 'shift', 'cmd'].filter((mod) => mods.has(mod)).map((mod) => names[mod]), key].join('+');
}

/** A key cap showing `keys` (see .kbd in base.css). */
export const kbd = (keys) => h('kbd', { class: 'kbd' }, formatKeys(keys));
