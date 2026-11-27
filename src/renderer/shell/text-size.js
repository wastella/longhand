// The code text size, shared by the editor and the terminal through the --code-size token and
// the text-size:changed event. A setting, so View > Bigger Text and the settings sheet agree.

import { emit, on } from '../state.js';
import { registerCommand } from './commands.js';
import { getSetting, registerSetting, setSetting } from './settings.js';

const DEFAULT_SIZE = 13;
const SIZES = [10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22];

function step(direction) {
  const index = SIZES.indexOf(getSetting('textSize'));
  setSetting('textSize', SIZES[Math.max(0, Math.min(index + direction, SIZES.length - 1))]);
}

export function mountTextSize() {
  registerSetting({
    id: 'textSize',
    label: 'Code text size',
    description: 'In the editor and the terminal.',
    type: 'choice',
    options: SIZES.map((size) => ({ value: size, label: size === DEFAULT_SIZE ? `${size} (default)` : String(size) })),
    default: DEFAULT_SIZE,
  });
  on('settings:changed', ({ id, value }) => {
    if (id !== 'textSize') return;
    document.documentElement.style.setProperty('--code-size', value + 'px');
    emit('text-size:changed', value);
  });
  registerCommand('zoom-in', () => step(1));
  registerCommand('zoom-out', () => step(-1));
  registerCommand('zoom-reset', () => setSetting('textSize', DEFAULT_SIZE));
}
