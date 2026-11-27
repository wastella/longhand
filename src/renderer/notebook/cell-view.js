// One cell on screen: its prompt ([3], [*]), its editor (a CodeMirror view with the editor's own
// setup), and for a code cell its outputs and how its last run went; for a Markdown cell the
// rendered text, which turns back into its source on Enter or a double-click. Its tools are Run,
// add a code or Markdown cell below, and Delete.

import { EditorView } from '@codemirror/view';
import { createCellState, refreshCellTheme } from '../editor/index.js';
import { h } from '../dom.js';
import { icon } from '../shell/index.js';
import { renderMarkdown } from './markdown.js';
import { outputNode } from './output-view.js';

const LANGUAGE = { code: 'python', markdown: 'markdown', raw: 'text' };
const TYPE_NAMES = { code: 'Code', markdown: 'Markdown', raw: 'Raw' };

/** "0.4 s", "12 s", "3 min 05 s": how long a run took. */
export function formatDuration(ms) {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

export class CellView {
  /** `cell` is a model cell; `notebook` the view (view.js), which owns the model and the kernel. */
  constructor(cell, notebook) {
    this.cell = cell;
    this.notebook = notebook;
    this.outputsShown = null;
    this.prompt = h('div', { class: 'nb-prompt', 'aria-hidden': 'true' });
    this.editorHost = h('div', { class: 'nb-input' });
    this.rendered = h('div', {
      class: 'nb-rendered nb-markdown',
      tabindex: '0',
      ondblclick: () => this.focusEditor(),
      onkeydown: (e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), this.focusEditor()),
      onfocus: () => this.notebook.focused(this),
    });
    this.outputs = h('div', { class: 'nb-outputs', 'aria-live': 'polite' });
    this.meta = h('div', { class: 'nb-meta' });
    this.dom = h(
      'div',
      { class: 'nb-cell', role: 'group', 'aria-label': `${TYPE_NAMES[cell.type]} cell`, 'data-type': cell.type, 'data-key': cell.key },
      this.prompt,
      h('div', { class: 'nb-body' }, this.editorHost, this.rendered, this.outputs, this.meta),
      this.buildTools(),
    );
    this.view = new EditorView({
      state: createCellState(cell.source, {
        language: LANGUAGE[cell.type],
        keys: [
          { key: 'Shift-Enter', run: () => (this.notebook.runCell(this, { advance: true }), true) },
          { key: 'Mod-Enter', run: () => (this.notebook.runCell(this), true) },
          { key: 'Ctrl-Enter', run: () => (this.notebook.runCell(this), true) },
        ],
        onUpdate: (update) => {
          if (update.docChanged) this.notebook.model.edited(cell, update.state.doc.toString());
          if (update.focusChanged && update.view.hasFocus) this.notebook.focused(this);
        },
      }),
      parent: this.editorHost,
    });
    this.editing = cell.type !== 'markdown' || !cell.source.trim();
    this.refresh();
  }

  buildTools() {
    const button = (name, label, tip, run) =>
      h('button', { type: 'button', class: 'button ghost small', 'aria-label': tip, 'data-tip': tip, onclick: run }, icon(name, 'small'), label);
    return h(
      'div',
      { class: 'nb-tools' },
      this.cell.type === 'code' && button('play', '', 'Run cell (⇧↩)', () => this.notebook.runCell(this)),
      button('plus', 'Code', 'Add a code cell below', () => this.notebook.addBelow(this, 'code')),
      button('plus', 'Markdown', 'Add a Markdown cell below', () => this.notebook.addBelow(this, 'markdown')),
      button('trash', '', 'Delete cell', () => this.notebook.remove(this)),
    );
  }

  /** Shows a Markdown cell's source or its rendered text (other cells always show their source). */
  setEditing(editing) {
    if (this.cell.type !== 'markdown' || editing === this.editing) return;
    this.editing = editing;
    this.refresh();
  }

  /** Renders a Markdown cell (Run on it). */
  render() {
    this.setEditing(false);
    this.rendered.focus({ preventScroll: true });
  }

  /** The student moved to another cell: a Markdown cell with text shows it rendered. */
  leave() {
    if (this.cell.source.trim()) this.setEditing(false);
  }

  refresh() {
    const showRendered = this.cell.type === 'markdown' && !this.editing;
    this.editorHost.hidden = showRendered;
    this.rendered.hidden = !showRendered;
    if (showRendered) {
      if (this.cell.source.trim()) renderMarkdown(this.rendered, this.cell.source, this.cell.rest.attachments);
      else this.rendered.replaceChildren(h('p', { class: 'nb-placeholder' }, 'Empty Markdown cell. Double-click or press Enter to write in it.'));
    }
    this.renderOutputs();
    this.renderRun();
  }

  renderOutputs() {
    const outputs = this.cell.type === 'code' ? this.cell.outputs : [];
    if (outputs === this.outputsShown) return;
    this.outputsShown = outputs;
    this.outputs.hidden = !outputs.length;
    this.outputs.replaceChildren(...outputs.map((output) => h('div', { class: 'nb-output' }, outputNode(output))));
  }

  /** The prompt, and the run's time or what became of it. */
  renderRun() {
    const { cell } = this;
    const run = this.notebook.kernel.runs.get(cell.key);
    const code = cell.type === 'code';
    const pending = run?.state === 'running' || run?.state === 'queued';
    this.prompt.textContent = !code ? '' : pending ? '[*]' : `[${cell.count ?? ' '}]`;
    this.dom.classList.toggle('running', run?.state === 'running');
    this.dom.classList.toggle('queued', run?.state === 'queued');
    let meta = '';
    if (code && run) {
      if (run.state === 'queued') meta = 'Waiting to run';
      else if (run.state === 'running') meta = `Running · ${formatDuration(performance.now() - run.started)}`;
      else if (run.note) meta = run.note;
      else if (run.duration != null) meta = `${run.state === 'error' ? 'Failed' : 'Ran'} in ${formatDuration(run.duration)}`;
    }
    this.meta.textContent = meta;
    this.meta.hidden = !meta;
    this.meta.classList.toggle('error', run?.state === 'error');
  }

  focusEditor() {
    this.setEditing(true);
    this.view.focus();
  }

  /** Gives the cell the focus: a rendered Markdown cell its text, any other its editor. */
  focus() {
    if (!this.rendered.hidden) this.rendered.focus({ preventScroll: true });
    else this.view.focus();
  }

  refreshTheme() {
    refreshCellTheme(this.view);
  }

  destroy() {
    this.view.destroy();
    this.dom.remove();
  }
}
