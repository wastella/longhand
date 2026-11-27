// A notebook in its tab: a bar with Run All, Interrupt, Restart and the kernel's state, then the
// cells. Each cell's editor has the editor's own keys plus Shift+Enter (run, then go to the next
// cell) and Cmd+Enter or Ctrl+Enter (run in place). Adding and deleting cells is undone with
// Cmd+Z while no cell's editor has the focus, or with Undo on the notice a deletion shows.

import { confirm } from '../backend.js';
import { h, spacer } from '../dom.js';
import { icon, notify, showStatus } from '../shell/index.js';
import { typeInTerminal } from '../terminal/index.js';
import { CellView } from './cell-view.js';
import { Kernel } from './kernel.js';
import { Notebook } from './model.js';

const STATUS = {
  off: ['Python', 'Starts when you run a cell'],
  starting: ['Starting Python…', 'Starting the kernel in this folder’s Python environment'],
  idle: ['Python · Idle', 'The kernel is ready; variables from cells you ran are kept'],
  busy: ['Python · Running', 'The kernel is running a cell'],
  stopped: ['Python stopped', 'Run a cell to start it again'],
  problem: ['Python could not start', ''],
};

export class NotebookView {
  /** `file` is what the editor passes a custom editor: { path, text, format, changed }. */
  constructor({ path, text, format, changed }) {
    this.path = path;
    this.notifyEditor = changed;
    this.model = new Notebook(text, { crlf: '\r\n', cr: '\r' }[format?.lineEnding] || '\n');
    this.kernel = new Kernel(this.model, path, () => this.kernelChanged());
    this.views = new Map();
    this.current = this.model.cells[0]?.key ?? null;
    this.ticker = 0;
    this.build();
    this.model.onChange((change) => this.modelChanged(change));
    this.renderCells();
  }

  build() {
    const tool = (name, label, tip, run) =>
      h('button', { type: 'button', class: 'button ghost small', 'data-tip': tip, onclick: run }, icon(name, 'small'), label);
    this.interruptButton = tool('stop', 'Interrupt', 'Stop the running cell', () => this.kernel.interrupt());
    this.statusText = h('span', { class: 'nb-kernel-status', role: 'status' });
    this.toolbar = h(
      'div',
      { class: 'nb-toolbar', role: 'toolbar', 'aria-label': 'Notebook' },
      tool('play', 'Run All', 'Run every cell from the top', () => this.runAll()),
      this.interruptButton,
      tool('refresh', 'Restart', 'Start a fresh kernel; variables are lost', () => this.restart()),
      spacer(),
      this.statusText,
    );
    this.notice = h('div', { class: 'nb-notice', hidden: true });
    this.list = h('div', { class: 'nb-cells' });
    this.scroller = h('div', { class: 'nb-scroll', tabindex: '-1' }, h('div', { class: 'nb-page' }, this.list));
    this.dom = h('div', { class: 'notebook', onkeydown: (e) => this.undoKey(e) }, this.toolbar, this.notice, this.scroller);
    this.renderKernel();
  }

  // ---- the model and the kernel changed ----

  modelChanged(change) {
    if (change.type === 'reset') {
      this.views.forEach((view) => view.destroy());
      this.views.clear();
    }
    if (change.type === 'reset' || change.type === 'cells') {
      this.renderCells();
      if (change.focus && this.views.has(change.focus)) this.views.get(change.focus).focusEditor();
    } else if (change.type === 'outputs') this.drawOutputsSoon(change.cell.key);
    this.notifyEditor();
  }

  /** Draws cells' new outputs once per frame, however many messages arrived in it. */
  drawOutputsSoon(key) {
    this.outputsDue ??= new Set();
    this.outputsDue.add(key);
    if (this.outputsFrame) return;
    this.outputsFrame = requestAnimationFrame(() => {
      this.outputsFrame = 0;
      for (const due of this.outputsDue) this.views.get(due)?.renderOutputs();
      this.outputsDue.clear();
    });
  }

  kernelChanged() {
    for (const view of this.views.values()) view.renderRun();
    this.renderKernel();
    clearInterval(this.ticker);
    // The running cell's time counts up.
    if (this.kernel.running) this.ticker = setInterval(() => this.views.forEach((view) => view.renderRun()), 1000);
  }

  renderCells() {
    const cells = this.model.cells;
    for (const [key, view] of this.views)
      if (!cells.includes(view.cell)) {
        view.destroy();
        this.views.delete(key);
      }
    const nodes = cells.map((cell) => {
      if (!this.views.has(cell.key)) this.views.set(cell.key, new CellView(cell, this));
      return this.views.get(cell.key).dom;
    });
    // Moved only where needed, so editors keep their focus and scroll.
    nodes.forEach((node, i) => this.list.children[i] !== node && this.list.insertBefore(node, this.list.children[i] || null));
  }

  renderKernel() {
    const { kernel } = this;
    const [label, tip] = STATUS[kernel.status];
    const live = kernel.status === 'idle' || kernel.status === 'busy';
    this.statusText.textContent = kernel.version && live ? label.replace('Python', `Python ${kernel.version}`) : label;
    this.statusText.dataset.state = kernel.status;
    if (tip) this.statusText.dataset.tip = tip;
    else delete this.statusText.dataset.tip;
    this.interruptButton.disabled = !kernel.running;
    this.renderNotice();
  }

  /** One message under the bar: Python could not start, stopped, or is not stopping. */
  renderNotice() {
    const { kernel } = this;
    const button = (label, run) => h('button', { type: 'button', class: 'button small primary', onclick: run }, label);
    let content = null;
    if (kernel.status === 'problem' && kernel.problem) {
      const { title, detail, fix } = kernel.problem;
      content = [
        h('strong', {}, title),
        h('p', {}, detail),
        fix &&
          h(
            'div',
            { class: 'nb-fix' },
            h('code', {}, fix),
            button('Put in Terminal', () => typeInTerminal(fix)),
          ),
        fix && h('p', { class: 'nb-hint' }, 'Run the command, then run the cell again.'),
      ];
    } else if (kernel.status === 'stopped') {
      content = [
        h('strong', {}, kernel.stopped),
        h('p', {}, 'Its variables are gone. Run the cells again to rebuild them; a new kernel starts with the first one.'),
      ];
    } else if (kernel.stuck) {
      content = [
        h('strong', {}, 'Python has not stopped.'),
        h('p', {}, 'The cell may be inside a long call that does not notice an interrupt.'),
        button('Restart Python', () => this.kernel.restart()),
      ];
    }
    this.notice.hidden = !content;
    this.notice.dataset.kind = kernel.status === 'problem' ? 'problem' : 'info';
    if (content) this.notice.replaceChildren(...content.filter(Boolean));
  }

  // ---- cells ----

  /** The cell the student is working in (last focused), which Run Cell runs. */
  focused(view) {
    this.current = view.cell.key;
    // A Markdown cell shows its rendered text again once the student moves to another cell.
    for (const other of this.views.values()) if (other !== view) other.leave();
  }

  /** Cmd+Z and Shift+Cmd+Z outside the cells' editors undo and redo adding and deleting cells. */
  undoKey(e) {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || e.target.closest('.cm-editor')) return;
    e.preventDefault();
    if (!(e.shiftKey ? this.model.redo() : this.model.undo())) showStatus(e.shiftKey ? 'Nothing to redo' : 'Nothing to undo');
  }

  addBelow(view, type) {
    this.model.insert(this.model.indexOf(view.cell.key) + 1, type);
  }

  remove(view) {
    const record = this.model.remove(view.cell.key);
    if (!record) return;
    this.scroller.focus({ preventScroll: true });
    notify({ message: 'Cell deleted.', action: { label: 'Undo', run: () => this.model.restore(record) } });
  }

  // ---- running ----

  /** Runs one cell: a code cell in the kernel, a Markdown cell by rendering it. Then, with `advance`, moves on. */
  runCell(view, { advance = false } = {}) {
    if (view.cell.type === 'code') this.kernel.run([view.cell]);
    else view.render();
    if (!advance) return;
    const index = this.model.indexOf(view.cell.key);
    const next = this.model.cells[index + 1];
    if (next) this.views.get(next.key).focusEditor();
    else this.model.insert(index + 1, 'code');
  }

  runCurrent() {
    const view = this.views.get(this.current);
    if (view) this.runCell(view, { advance: true });
  }

  runAll() {
    for (const view of this.views.values()) if (view.cell.type === 'markdown') view.render();
    this.kernel.run(this.model.cells);
  }

  async restart() {
    if (this.kernel.status === 'off') return showStatus('Python is not running yet');
    if (!(await confirm('Restart Python? Its variables will be lost.', 'Restart'))) return;
    await this.kernel.restart();
  }

  // ---- what the editor asks of a custom editor ----

  show() {
    this.dom.hidden = false;
    this.views.forEach((view) => view.refreshTheme());
    this.views.get(this.current)?.focus();
  }

  hide() {
    this.dom.hidden = true;
  }

  /** Where the student is, for the tutor: "cell 3 of 12". */
  place() {
    const index = this.model.indexOf(this.current);
    return index < 0 ? null : `cell ${index + 1} of ${this.model.cells.length}`;
  }

  close() {
    clearInterval(this.ticker);
    cancelAnimationFrame(this.outputsFrame);
    this.kernel.shutdown();
    this.views.forEach((view) => view.destroy());
  }
}
