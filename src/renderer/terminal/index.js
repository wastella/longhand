// The terminal: xterm.js on top of a login shell the backend runs in the open folder.

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke, listen } from '../backend.js';
import { h, token } from '../dom.js';
import { on } from '../state.js';
import { addBottomPane, showBottomPane } from '../shell/index.js';

const pane = h('div', { id: 'terminal', class: 'bottom-pane' });
const fitAddon = new FitAddon();
let xterm;
/** The backend's id for the running shell; 0 while none is running. */
let shellId = 0;

// xterm draws its own colours, so it takes the token values rather than CSS.
const theme = () => ({
  background: token('--color-surface'),
  foreground: token('--color-text'),
  cursor: token('--color-accent'),
  selectionBackground: token('--color-selection'),
});

function fit() {
  if (pane.hidden || !pane.offsetHeight) return;
  try {
    fitAddon.fit();
  } catch {
    // The pane can be mid-layout (zero-sized); the ResizeObserver fits it once it settles.
  }
}

async function start() {
  fit();
  xterm.reset();
  shellId = await invoke('term_start', { cols: xterm.cols, rows: xterm.rows });
}

function onExit({ id }) {
  if (id !== shellId) return;
  shellId = 0;
  xterm.write('\r\n\x1b[2m[shell exited; press any key to restart]\x1b[0m\r\n');
  const once = xterm.onKey(() => (once.dispose(), start()));
}

/** Sends `text` to the shell as if typed (end it with \r to run it). Resolves once the shell has it. */
export async function sendToTerminal(text) {
  if (shellId) await invoke('term_input', { id: shellId, data: text });
}

/** Brings the terminal to the front, then types `text` into it for the student to run. */
export function typeInTerminal(text) {
  showBottomPane('terminal');
  sendToTerminal(text);
}

/** The terminal's size in characters, as { cols, rows }. */
export const terminalSize = () => ({ cols: xterm.cols, rows: xterm.rows });

export function mount() {
  addBottomPane({ name: 'terminal', label: 'Terminal', body: pane, onShow: () => requestAnimationFrame(() => (fit(), xterm.focus())) });
  xterm = new Terminal({ fontFamily: token('--font-mono'), fontSize: 12, theme: theme(), cursorBlink: true, scrollback: 5000 });
  xterm.loadAddon(fitAddon);
  xterm.open(pane);
  xterm.onData((data) => shellId && invoke('term_input', { id: shellId, data }));
  xterm.onResize(({ cols, rows }) => shellId && invoke('term_resize', { id: shellId, cols, rows }));
  new ResizeObserver(fit).observe(pane);

  listen('term:data', ({ id, data }) => id === shellId && xterm.write(data));
  listen('term:exit', onExit);
  on('workspace:opened', start);
  on('panel:toggled', ({ id, visible }) => id === 'bottom' && visible && requestAnimationFrame(fit));
  on('text-size:changed', (size) => {
    xterm.options.fontSize = size - 1;
    fit();
  });
}
