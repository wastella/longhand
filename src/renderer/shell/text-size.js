// The code text size (View > Bigger Text / Smaller Text), shared by the editor and the terminal
// through the --code-size token and the text-size:changed event. Remembered across launches.

import { emit } from '../state.js';
import { registerCommand } from './commands.js';

const DEFAULT_SIZE = 13;
const MIN_SIZE = 10;
const MAX_SIZE = 22;

const savedSize = () => Number(localStorage.getItem('fontSize')) || DEFAULT_SIZE;

function setTextSize(size) {
  size = Math.max(MIN_SIZE, Math.min(size, MAX_SIZE));
  localStorage.setItem('fontSize', String(size));
  document.documentElement.style.setProperty('--code-size', size + 'px');
  emit('text-size:changed', size);
}

export function mountTextSize() {
  registerCommand('zoom-in', () => setTextSize(savedSize() + 1));
  registerCommand('zoom-out', () => setTextSize(savedSize() - 1));
  registerCommand('zoom-reset', () => setTextSize(DEFAULT_SIZE));
}

/** Applies the remembered size. Called once every area is mounted, so all of them hear it. */
export const applySavedTextSize = () => setTextSize(savedSize());
