// Jupyter notebooks: an .ipynb file opens as cells in its tab, and runs in the folder's own
// Python. The editor opens, saves and reloads the file like any other (registerCustomEditor);
// this area draws it and runs it. Other areas import from this file only.

import { listen } from '../backend.js';
import { activeFile, registerCustomEditor } from '../editor/index.js';
import { on } from '../state.js';
import { registerCommand, registerLeaveGuard, showStatus } from '../shell/index.js';
import { NotebookError } from './format.js';
import { exited, receive } from './kernel.js';
import { NotebookView } from './view.js';

/** The open notebooks, by path. */
const open = new Map();

/** The custom editor the editor uses for .ipynb files. */
function openNotebook(file) {
  let view;
  try {
    view = new NotebookView(file);
  } catch (e) {
    if (!(e instanceof NotebookError)) throw e;
    return { notice: notebookNotice(file.path, e) };
  }
  let path = file.path;
  open.set(path, view);
  return {
    dom: view.dom,
    snapshot: () => view.model.snapshot(),
    markSaved: (mark) => (view.model.markSaved(mark), file.changed()),
    dirty: () => view.model.isDirty(),
    version: () => view.model.version,
    load: (text) => {
      try {
        view.model.replace(text);
        return null;
      } catch (e) {
        if (!(e instanceof NotebookError)) throw e;
        return notebookNotice(path, e);
      }
    },
    show: () => view.show(),
    hide: () => view.hide(),
    rename: (to) => {
      open.delete(path);
      open.set((path = to), view);
      view.path = view.kernel.path = to;
    },
    close: () => {
      open.delete(path);
      view.close();
    },
    running: () => view.kernel.running,
    place: () => view.place(),
  };
}

function notebookNotice(path, error) {
  const name = path.split('/').pop();
  const title = error.kind === 'old' || error.kind === 'new' ? `${name} uses another notebook format` : `${name} could not be read as a notebook`;
  return { kind: 'custom', title, detail: error.message };
}

/** The notebook on screen, or null. */
function current() {
  const path = activeFile()?.path;
  return (path && open.get(path)) || null;
}

const onNotebook = (run) => () => {
  const view = current();
  if (!view) return showStatus('Open a notebook first');
  run(view);
};

/** What quitting or switching folder would stop, for the shell's leave guard. */
function runningCells(reason) {
  const busy = [...open.entries()].filter(([, view]) => view.kernel.running);
  if (!busy.length) return null;
  const which = busy.length === 1 ? `${busy[0][0]} is still running a cell.` : `${busy.length} notebooks are still running cells.`;
  return reason === 'quit'
    ? { message: `${which} Quit and stop it?`, action: 'Quit and Stop' }
    : { message: `${which} Open another folder and stop it?`, action: 'Stop and Open' };
}

export function mount() {
  registerCustomEditor('ipynb', openNotebook);
  listen('notebook:message', receive);
  listen('notebook:exit', exited);
  const commands = {
    'notebook-run-cell': (view) => view.runCurrent(),
    'notebook-run-all': (view) => view.runAll(),
    'notebook-interrupt': (view) => view.kernel.interrupt(),
    'notebook-restart': (view) => view.restart(),
  };
  for (const [id, run] of Object.entries(commands)) registerCommand(id, onNotebook(run));
  registerLeaveGuard(runningCells);
  on('theme:changed', () => open.forEach((view) => view.views.forEach((cell) => cell.refreshTheme())));
}
