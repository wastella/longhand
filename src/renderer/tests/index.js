// The test panel: runs pytest through the backend and shows the results.

import { invoke, listen } from '../backend.js';
import { h } from '../dom.js';
import { emit, on, state } from '../state.js';
import { activeFile, saveAll } from '../editor/index.js';
import { addBottomPane, registerCommand, showBottomPane, showStatus } from '../shell/index.js';
import { appendOutput, badge, pane, showCommand, showError, showResults, showRunning, showWaiting } from './results.js';

const TEST_FILE = /(^|\/)test_[^/]*\.py$|_test\.py$/;

/** Runs every test, or only the open test file when `fileOnly`. */
async function runTests(fileOnly) {
  if (!state.workspace) return;
  let target = null;
  if (fileOnly) {
    const path = activeFile()?.path;
    if (!path || !TEST_FILE.test(path)) return showStatus('Open a test file (test_*.py) to run just that file');
    target = path;
  }
  // Tests run against what is on disk, so save first.
  await saveAll();
  showBottomPane('tests');
  showRunning();
  try {
    showCommand(await invoke('tests_run', { target }));
  } catch (e) {
    showError(String(e));
  }
}

export function mount() {
  const actions = h(
    'span',
    { id: 'tests-actions' },
    h('button', { id: 'run-file-tests', class: 'ghost', onclick: () => runTests(true) }, 'Run file'),
    h('button', { id: 'run-all-tests', class: 'ghost', onclick: () => runTests(false) }, 'Run all'),
  );
  addBottomPane({ name: 'tests', label: ['Tests ', badge], body: pane, actions });
  showWaiting();

  registerCommand('run-tests', () => runTests(false));
  registerCommand('run-tests-file', () => runTests(true));
  listen('tests:output', appendOutput);
  listen('tests:done', (result) => {
    showResults(result);
    emit('tests:finished', result);
  });
  on('workspace:opened', showWaiting);
}
