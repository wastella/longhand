// One terminal: an xterm.js view and the login shell behind it. The shell keeps running, with
// its scrollback, while the view is hidden.

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { invoke } from '../backend.js';
import { h, token } from '../dom.js';
import { terminalKeys } from './keys.js';
import { addLinks } from './links.js';
import { codeSize, terminalFontSize, terminalTheme } from './theme.js';

// Ids are made here rather than by the backend, so output that arrives before term_start
// returns already has a terminal to go to. The page's start time keeps them unique across reloads.
const pageKey = Date.now().toString(36);
let started = 0;

/** A shell counts as ready once its output has paused this long (its prompt is up). */
const PROMPT_QUIET_MS = 200;
/** Or this long after starting, whatever it printed, so a silent shell cannot hold Run File up. */
const READY_TIMEOUT_MS = 10000;

// Shells left running by an earlier load of this page (a reload) are stopped before any starts.
let cleared = Promise.resolve();
export function stopEarlierShells() {
  cleared = invoke('term_reset');
}

/** Lines kept above the screen; enough for a long traceback, bounded so heavy output cannot balloon memory. */
const SCROLLBACK = 5000;

export class TerminalSession {
  /** `number` is the terminal's label; `onChange` runs when it starts or exits. */
  constructor(number, onChange) {
    this.number = number;
    this.onChange = onChange;
    /** The backend's id for the running shell, or null while none runs. */
    this.id = null;
    this.exited = false;
    /** Resolves when the shell has printed its prompt; see start(). */
    this.ready = Promise.resolve();
    this.element = h('div', { class: 'term-view', hidden: true });
    this.fitAddon = new FitAddon();
    this.xterm = new Terminal({
      allowProposedApi: true, // for the Unicode 11 widths
      fontFamily: token('--font-mono'),
      fontSize: terminalFontSize(codeSize()),
      lineHeight: 1.15,
      theme: terminalTheme(),
      cursorBlink: true,
      scrollback: SCROLLBACK,
    });
    this.xterm.loadAddon(this.fitAddon);
    this.xterm.loadAddon(new Unicode11Addon());
    this.xterm.unicode.activeVersion = '11';
    this.xterm.attachCustomKeyEventHandler(terminalKeys(this.xterm));
    this.xterm.onData((data) => this.id && invoke('term_input', { id: this.id, data }));
    this.xterm.onResize(({ cols, rows }) => this.id && invoke('term_resize', { id: this.id, cols, rows }));
    new ResizeObserver(() => this.fitSoon()).observe(this.element);
  }

  /** Puts the view into `container`, which must already be in the page. */
  open(container) {
    container.append(this.element);
    this.element.hidden = false;
    this.xterm.open(this.element);
    addLinks(this, container);
  }

  /** Matches the terminal's rows and columns to its view; does nothing while it is hidden. */
  fit() {
    if (this.element.offsetWidth && this.element.offsetHeight) this.fitAddon.fit();
  }

  /** Fits on the next frame, once whatever changed the layout has settled. Repeated calls fit once. */
  fitSoon() {
    if (this.fitFrame) return;
    this.fitFrame = requestAnimationFrame(() => {
      this.fitFrame = null;
      this.fit();
    });
  }

  show() {
    this.element.hidden = false;
    this.fit();
    this.xterm.focus();
  }

  hide() {
    this.element.hidden = true;
  }

  /**
   * Starts a fresh shell in the open folder. Resolves once it is started; `ready` resolves
   * later, when the shell has printed its prompt (or failed to start).
   */
  async start() {
    this.stop();
    this.fit();
    this.xterm.reset();
    this.exited = false;
    const id = `${pageKey}-${++started}`;
    this.id = id;
    this.ready = new Promise((resolve) => (this.markReady = resolve));
    this.readyTimer = setTimeout(() => this.settle(), READY_TIMEOUT_MS);
    this.onChange();
    try {
      await cleared;
      await invoke('term_start', { id, cols: this.xterm.cols, rows: this.xterm.rows });
    } catch (e) {
      if (this.id !== id) return;
      this.id = null;
      this.xterm.write(`\x1b[31m${e}\x1b[0m\r\n`);
      this.offerRestart('[The terminal could not start. Press any key to try again.]');
    }
  }

  /** Resolves `ready`. */
  settle() {
    clearTimeout(this.readyTimer);
    clearTimeout(this.quietTimer);
    this.markReady?.();
    this.markReady = null;
  }

  /** Stops the shell and everything running in it. */
  stop() {
    this.settle();
    this.restartKey?.dispose();
    this.restartKey = null;
    if (this.id) invoke('term_close', { id: this.id });
    this.id = null;
  }

  /** Draws output, then tells the backend it may send more. */
  receive(data, bytes) {
    const id = this.id;
    this.xterm.write(data, () => invoke('term_ack', { id, bytes }));
    if (this.markReady) {
      clearTimeout(this.quietTimer);
      this.quietTimer = setTimeout(() => this.settle(), PROMPT_QUIET_MS);
    }
  }

  /** The shell exited by itself (exit, Ctrl+D, a crash). */
  exitedWith(code) {
    this.id = null;
    this.offerRestart(`[The shell exited${code ? ` with code ${code}` : ''}. Press any key to start a new one.]`);
  }

  offerRestart(message) {
    this.exited = true;
    this.settle();
    this.xterm.write(`\r\n\x1b[2m${message}\x1b[0m\r\n`);
    this.restartKey = this.xterm.onKey(() => this.start());
    this.onChange();
  }

  setFontSize(size) {
    this.xterm.options.fontSize = size;
    this.fitSoon();
  }

  setTheme(theme) {
    this.xterm.options.theme = theme;
  }

  dispose() {
    this.stop();
    this.xterm.dispose();
    this.element.remove();
  }
}
