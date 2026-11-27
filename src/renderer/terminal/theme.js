// The terminal's colours and type. xterm.js draws its own cells, so it takes token values
// rather than CSS; they are read again when the theme changes.

import { token } from '../dom.js';

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

export function terminalTheme() {
  const theme = {
    background: token('--color-surface'),
    foreground: token('--color-text'),
    cursor: token('--color-accent'),
    cursorAccent: token('--color-surface'),
    selectionBackground: token('--color-selection'),
    selectionInactiveBackground: token('--color-selection'),
    scrollbarSliderBackground: token('--color-scrollbar'),
    scrollbarSliderHoverBackground: token('--color-border-strong'),
    scrollbarSliderActiveBackground: token('--color-border-strong'),
  };
  for (const name of ANSI) {
    theme[name] = token(`--color-ansi-${name}`);
    theme[`bright${name[0].toUpperCase()}${name.slice(1)}`] = token(`--color-ansi-bright-${name}`);
  }
  return theme;
}

/** The terminal's text size for a code text size: a point smaller, as terminals pack more in. */
export const terminalFontSize = (codeSize) => codeSize - 1;

/** The code text size the shell has applied, from the --code-size token. */
export const codeSize = () => parseFloat(token('--code-size')) || 13;
