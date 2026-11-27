// A notebook's Python kernel, as the interface sees it, and the queue of cells it runs.
//
// The backend (notebook.rs) starts a small helper in the folder's own Python, which starts
// ipykernel and relays its messages as `notebook:message` events (see the protocol at the top of
// src-tauri/src/notebook/kernel.py); `notebook:exit` says the helper ended, with a `problem` when
// it could not start the kernel. Nothing starts until the student runs a cell: a notebook may
// come from anywhere, and opening it must not run its code.

import { invoke } from '../backend.js';
import { addOutput, updateDisplay } from './outputs.js';

/** Kernels by id, for routing backend events. */
const kernels = new Map();
let nextRun = 1;

/** Routes a `notebook:message` event to its kernel and acknowledges it. */
export function receive({ id, message, bytes }) {
  kernels.get(id)?.receive(message);
  invoke('notebook_ack', { id, bytes });
}

/** Routes a `notebook:exit` event. */
export function exited({ id, ...exit }) {
  kernels.get(id)?.exited(exit);
}

/** How a kernel that stopped by itself ended, in words. */
export function describeDeath({ code, signal }) {
  if (signal === 9) return 'Python was stopped by the system, which usually means it ran out of memory.';
  if (signal) return `Python stopped with signal ${signal}.`;
  if (code === 0) return 'Python exited (the code called exit() or os._exit()).';
  return `Python stopped unexpectedly${code != null ? ` (exit code ${code})` : ''}.`;
}

/**
 * The kernel for one notebook. `status` is 'off' (never started, or shut down), 'starting',
 * 'idle', 'busy', 'stopped' (it ended by itself; `stopped` says how) or 'problem' (it could not
 * start; `problem` is { title, detail, fix? }). `runs` maps a cell's key to its latest run:
 * { id, state: 'queued' | 'running' | 'done' | 'error' | 'aborted' | 'cancelled', started,
 * duration, note }. `onChange()` is called after any of it changes.
 */
export class Kernel {
  constructor(notebook, path, onChange) {
    this.notebook = notebook;
    this.path = path;
    this.onChange = onChange;
    this.id = null;
    this.status = 'off';
    this.problem = null;
    this.stopped = null;
    this.version = null;
    this.runs = new Map();
    this.byId = new Map();
    this.queue = [];
    this.displays = new WeakMap();
    this.clearNext = new Set();
    this.interruptTimer = 0;
    this.stuck = false;
  }

  changed() {
    this.onChange();
  }

  /** True while a cell is running or waiting to. */
  get running() {
    return [...this.byId.values()].some((run) => run.state === 'queued' || run.state === 'running');
  }

  async start() {
    this.id = `nb-${crypto.randomUUID()}`;
    kernels.set(this.id, this);
    Object.assign(this, { status: 'starting', problem: null, stopped: null, stuck: false });
    this.changed();
    try {
      await invoke('notebook_start', { id: this.id, path: this.path });
    } catch (e) {
      this.forget();
      this.fail({ title: 'Python could not start', detail: String(e) });
    }
  }

  forget() {
    if (this.id) kernels.delete(this.id);
    this.id = null;
  }

  /** Ends every run that has not finished, saying why. */
  cancelRuns(note) {
    for (const run of this.byId.values()) {
      if (run.state !== 'queued' && run.state !== 'running') continue;
      run.state = 'cancelled';
      run.note = note;
      if (run.started) run.duration = performance.now() - run.started;
    }
    this.byId.clear();
    this.queue = [];
  }

  fail(problem) {
    this.status = 'problem';
    this.problem = problem;
    this.cancelRuns(null);
    this.changed();
  }

  /** Queues `cells` (code cells with code) to run in order, starting the kernel if it is not running. */
  run(cells) {
    for (const cell of cells) {
      if (cell.type !== 'code' || !cell.source.trim()) continue;
      const previous = this.runs.get(cell.key);
      if (previous && (previous.state === 'queued' || previous.state === 'running')) continue;
      const run = { id: `r${nextRun++}`, cell, state: 'queued', started: 0, duration: null, note: null };
      this.runs.set(cell.key, run);
      this.byId.set(run.id, run);
      this.queue.push(run);
    }
    if (!this.queue.length) return this.changed();
    if (this.status === 'off' || this.status === 'stopped' || this.status === 'problem') this.start();
    else this.flush();
    this.changed();
  }

  /** Sends queued runs to the kernel, which runs them one after another. */
  flush() {
    if (this.status !== 'idle' && this.status !== 'busy') return;
    for (const run of this.queue.splice(0)) this.send({ op: 'execute', run: run.id, code: run.cell.source });
  }

  send(message) {
    if (this.id) invoke('notebook_send', { id: this.id, message }).catch((e) => console.warn('Could not reach the kernel:', e));
  }

  receive(message) {
    const run = message.run && this.byId.get(message.run);
    switch (message.type) {
      case 'ready':
        this.status = 'idle';
        this.version = message.python || null;
        this.flush();
        break;
      case 'status':
        if (this.status === 'idle' || this.status === 'busy') this.status = message.state === 'busy' ? 'busy' : 'idle';
        if (message.state === 'idle' && !this.running) this.settleInterrupt();
        break;
      case 'problem':
        this.problem = { title: message.title, detail: message.detail, fix: message.fix };
        break;
      case 'start':
        if (!run) return;
        run.state = 'running';
        run.started = performance.now();
        this.notebook.setOutputs(run.cell, [], message.count ?? null);
        break;
      case 'output':
        if (!run) return;
        this.output(run, message.output, message.display);
        break;
      case 'update':
        for (const cell of this.notebook.cells) {
          const next = updateDisplay(cell.outputs, this.displays, message.display, message.output);
          if (next !== cell.outputs) this.notebook.setOutputs(cell, next);
        }
        break;
      case 'clear':
        if (!run) return;
        if (message.wait) this.clearNext.add(run.id);
        else this.notebook.setOutputs(run.cell, []);
        break;
      case 'done':
        if (!run) return;
        this.finish(run, message);
        break;
      default:
        return;
    }
    this.changed();
  }

  output(run, output, display) {
    let outputs = run.cell.outputs;
    if (this.clearNext.delete(run.id)) outputs = [];
    outputs = addOutput(outputs, output);
    if (display) this.displays.set(outputs[outputs.length - 1], display);
    this.notebook.setOutputs(run.cell, outputs);
  }

  finish(run, { status, count }) {
    this.byId.delete(run.id);
    if (status === 'aborted') {
      run.state = 'aborted';
      run.note = 'Not run, because a cell before it stopped with an error.';
    } else {
      run.state = status === 'ok' ? 'done' : 'error';
      run.duration = performance.now() - run.started;
      if (count != null && count !== run.cell.count) this.notebook.setOutputs(run.cell, run.cell.outputs, count);
    }
    if (!this.running) this.settleInterrupt();
  }

  /** The helper ended: it could not start the kernel, the kernel died, or it was stopped. */
  exited({ code, signal, problem, kernel }) {
    this.forget();
    if (problem || this.problem) return this.fail(problem || this.problem);
    if (this.status === 'starting') return this.fail({ title: 'Python could not start', detail: describeDeath({ code, signal }) });
    this.status = 'stopped';
    this.stopped = describeDeath(kernel || { code, signal });
    this.cancelRuns('Python stopped while this cell was running.');
    this.settleInterrupt();
    this.changed();
  }

  /** Stops the running cell (KeyboardInterrupt). If Python does not stop soon, offers a restart. */
  interrupt() {
    if (!this.running || !this.id) return;
    this.send({ op: 'interrupt' });
    clearTimeout(this.interruptTimer);
    this.interruptTimer = setTimeout(() => {
      if (this.running) {
        this.stuck = true;
        this.changed();
      }
    }, 5000);
  }

  settleInterrupt() {
    clearTimeout(this.interruptTimer);
    this.stuck = false;
  }

  /** Stops the kernel and everything it started. Its variables are gone. */
  async shutdown(note = 'The kernel was stopped before this cell finished.') {
    const id = this.id;
    this.forget();
    this.cancelRuns(note);
    this.settleInterrupt();
    Object.assign(this, { status: 'off', problem: null, stopped: null });
    this.changed();
    if (id) await invoke('notebook_stop', { id }).catch(() => {});
  }

  /** Stops this kernel and starts a fresh one, with none of its variables. */
  async restart() {
    await this.shutdown('The kernel was restarted before this cell finished.');
    this.start();
  }
}
