// The test panel: runs pytest through the backend and shows the results as they arrive.
// Other areas import from this file only.

import { h } from '../dom.js';
import { emit, on, state } from '../state.js';
import { activeFile, saveAll } from '../editor/index.js';
import { addBottomPane, registerCommand, showBottomPane, showStatus } from '../shell/index.js';
import { rawOutput, testDetail } from './detail.js';
import { disposeAll, panelFor, prunePanels } from './failure-panels.js';
import { firstRun, problemNotice, summary, tree } from './list.js';
import { count, failed, parseId } from './model.js';
import * as runner from './runner.js';

export { registerFailurePanel } from './failure-panels.js';

const TEST_FILE = /(^|\/)test_[^/]*\.py$|_test\.py$/;

const badge = h('span', { id: 'tests-badge' });
const head = h('div', { id: 'tests-head' });
const rows = h('div', { id: 'tests-rows', role: 'tree', 'aria-label': 'Test results', onkeydown: navigate });
const list = h('div', { id: 'tests-list' }, head, rows);
const detail = h('div', { id: 'tests-detail', 'aria-live': 'polite' });
const pane = h('div', { id: 'tests', class: 'bottom-pane', onkeydown: stopOnEscape }, list, detail);

const button = (id, label, title, onclick) => h('button', { id, class: 'ghost', title, onclick }, label);
const rerunButton = button('rerun-failed-tests', 'Rerun failed', 'Run the failing tests again (⌘⇧Y)', () => rerunFailed());
const fileButton = button('run-file-tests', 'Run file', 'Run the tests in the open file (⌘T)', () => runFile());
const allButton = button('run-all-tests', 'Run all', 'Run every test (⌘⇧T)', () => runTests([]));
const stopButton = button('cancel-tests', 'Stop', 'Stop the run (Esc)', () => runner.cancel());
const actions = h('span', { id: 'tests-actions', onkeydown: stopOnEscape }, stopButton, rerunButton, fileButton, allButton);

/** What the detail side shows: a test (by node id) or the raw output. */
const view = { selectedId: null, output: false, focusKey: null, shown: null, announced: null };
let clockTimer = null;
let frame = 0;

const shownTests = () => runner.shownTests();
const shownErrors = () => runner.shownErrors();
const findResult = (id) => [...shownErrors(), ...shownTests()].find((test) => test.id === id) || null;
const failures = () => [...runner.results.errors, ...runner.results.tests].filter(failed);

// ---- running ----

/** Runs `targets` (node ids or paths; every test when empty), saving open files first. */
async function runTests(targets) {
  if (!state.workspace) return;
  // Tests run against what is on disk, so a file that could not be saved would mean testing
  // the old code without a word: say so instead.
  const saved = await saveAll();
  showBottomPane('tests');
  if (!saved) return runner.refuse(targets, NOT_SAVED);
  await runner.start(targets);
}

const NOT_SAVED = {
  kind: 'not-saved',
  title: 'The tests did not run: a file could not be saved',
  detail:
    'They would have tested the version on disk, not your edits. The editor says what went wrong with the save; fix that (or undo the edits), then run the tests again.',
};

/**
 * Whether a change on disk can change test results: Python code and test configuration, not
 * caches, environments or Longhand's own files (a run writes .pytest_cache and __pycache__).
 */
const SKIPPED_DIRS = /(^|\/)(\.longhand|\.git|\.pytest_cache|__pycache__|\.venv|venv|\.mypy_cache|\.ruff_cache|node_modules|\.tox)(\/|$)/;
const AFFECTS_TESTS = /\.(py|pyi|pyx|toml|cfg|ini|lock)$|(^|\/)requirements[^/]*\.txt$/;
const affectsTests = (path) => path === '' || (!SKIPPED_DIRS.test(path) && AFFECTS_TESTS.test(path));

function runFile() {
  const path = activeFile()?.path;
  if (!path || !TEST_FILE.test(path)) return showStatus('Open a test file (test_*.py) to run just that file');
  return runTests([path]);
}

function rerunFailed() {
  const ids = failures().map((test) => test.id);
  if (!ids.length) return showStatus(runner.results.ran ? 'No failing tests to run again' : 'Run the tests first');
  return runTests(ids);
}

/** Runs again what may be out of date: its files, or everything if that is every file. */
function runStale() {
  const { results } = runner;
  const files = new Set([...results.stale, ...results.unreached].map((id) => parseId(id).file));
  const all = new Set([...runner.results.tests, ...runner.results.errors].map((test) => parseId(test.id).file));
  return runTests(files.size >= all.size ? [] : [...files]);
}

function stopOnEscape(event) {
  if (event.key === 'Escape' && runner.run.active) {
    event.preventDefault();
    runner.cancel();
  }
}

// ---- rendering ----

/** Tells other areas which result is shown, when that changes (or the result itself does). */
function announce(test) {
  if (view.announced === test) return;
  view.announced = test;
  emit('tests:selected', test);
}

function select(test, { focus = false } = {}) {
  view.output = false;
  view.selectedId = test?.id ?? null;
  view.focusKey = test?.id ?? view.focusKey;
  announce(test || null);
  renderList(focus);
  renderDetail();
}

/** "Ask tutor" on a failing row: shows the failure and moves to the help attached beneath it. */
function askAbout(test) {
  select(test);
  detail.querySelector('.tests-failure-panel :is(input, textarea, button)')?.focus();
}

function showOutput() {
  view.output = !view.output || !view.selectedId;
  if (view.output) {
    view.selectedId = null;
    announce(null);
  }
  renderList();
  renderDetail();
}

/** The results with a row for the test running now, in place of its earlier result if any. */
function rowsToShow(waiting) {
  const tests = shownTests();
  const current = runner.run.current;
  if (!runner.run.active || !current) return tests;
  const row = { id: current, status: 'RUNNING', duration: 0, frames: [], sections: [] };
  const i = tests.findIndex((t) => t.id === current);
  if (i < 0) return [...tests, row];
  return waiting.has(current) ? tests.with(i, row) : tests;
}

/** Results that may no longer hold: from before a save, not reached, or about to be rerun. */
function staleIds() {
  const waiting = runner.awaiting();
  return { waiting, has: (id) => runner.isStale(id) || waiting.has(id) };
}

function renderHead() {
  const { run, results } = runner;
  const parts = [];
  const tests = shownTests();
  const errors = shownErrors();
  if (!run.active && results.problem) parts.push(problemNotice(results.problem));
  // With a problem and nothing to tally, the problem says it all and the output is beside it.
  if (run.active || (results.ran && (tests.length || errors.length || !results.problem))) {
    parts.push(summary({ run, results, tests, errors, outputShown: view.output, onShowOutput: showOutput, onRunStale: runStale }));
  } else if (!results.problem) {
    parts.push(...firstRun());
  }
  head.replaceChildren(...parts);
}

function renderList(focus = false) {
  renderHead();
  const hadFocus = rows.contains(document.activeElement);
  const stale = staleIds();
  const fresh = tree({
    tests: [...shownErrors(), ...rowsToShow(stale.waiting)],
    staleIds: stale,
    on: { select: (test) => select(test, { focus: true }), run: runTests, ask: askAbout, rerender: (key) => ((view.focusKey = key), renderList(true)) },
  });
  // Rows with the same content are kept rather than replaced, so a click that lands while
  // results arrive still reaches its row. Selection and focus are applied to them afterwards.
  const current = new Map([...rows.children].map((row) => [row.dataset.key, row]));
  const kept = fresh.map((row) => {
    row.dataset.look = row.outerHTML;
    const old = current.get(row.dataset.key);
    return old && old.dataset.look === row.dataset.look ? old : row;
  });
  rows.replaceChildren(...kept);
  const selectedRow = kept.find((row) => row.dataset.id && row.dataset.id === view.selectedId);
  // One row is reachable with Tab, along with its buttons; the arrow keys move from there.
  const anchor = kept.find((row) => row.dataset.key === view.focusKey) || selectedRow || kept[0];
  for (const row of kept) {
    row.classList.toggle('active', row === selectedRow);
    if (row.dataset.id) row.setAttribute('aria-selected', String(row === selectedRow));
    row.tabIndex = row === anchor ? 0 : -1;
    for (const control of row.querySelectorAll('button')) control.tabIndex = row === anchor ? 0 : -1;
  }
  if (anchor && (focus || hadFocus)) anchor.focus({ preventScroll: !focus });
  if (anchor && focus) anchor.scrollIntoView({ block: 'nearest' });
  renderBadge();
  renderButtons();
}

function renderDetail() {
  const { run, results } = runner;
  if (view.output || (!view.selectedId && (run.active || results.problem || results.ran))) {
    const output = run.active ? run.output : results.output;
    const key = `output:${output.length}`;
    if (view.shown === key) return;
    view.shown = key;
    detail.replaceChildren(...rawOutput(output, run.active ? run.command : results.command));
    return;
  }
  const test = view.selectedId && findResult(view.selectedId);
  // While a test is being rerun, its last result stays on screen until the new one arrives.
  if (!test) {
    if (!view.selectedId) ((view.shown = null), detail.replaceChildren());
    return;
  }
  announce(test);
  const stale = results.unreached.has(test.id) ? 'unreached' : results.stale.has(test.id) ? 'saved' : runner.awaiting().has(test.id) ? 'rerunning' : '';
  if (view.shown === test && detail.dataset.stale === stale) return;
  view.shown = test;
  detail.dataset.stale = stale;
  const panel = panelFor(test);
  detail.replaceChildren(...testDetail(test, { stale, panel, onRun: () => runTests([test.id]) }));
  detail.scrollTop = 0;
}

function renderBadge() {
  const { run, results } = runner;
  badge.className = '';
  if (run.active) {
    const done = run.tests.length + run.errors.length;
    badge.textContent = run.total ? `${done}/${run.total}` : run.started ? `${done}` : '…';
    return;
  }
  const all = [...results.tests, ...results.errors];
  const bad = all.filter(failed).length;
  const doubtful = results.stale.size || results.unreached.size;
  // A run that stopped or crashed partway never reads as passing.
  const incomplete = !results.complete;
  badge.textContent = !all.length ? '' : bad ? `${bad} failing` : incomplete ? 'incomplete' : 'passing';
  badge.className = !all.length ? '' : `${bad ? 'fail' : incomplete ? 'incomplete' : 'pass'}${doubtful || incomplete ? ' stale' : ''}`;
}

function renderButtons() {
  const active = runner.run.active;
  stopButton.hidden = !active;
  rerunButton.disabled = !failures().length;
}

function render(what) {
  if (what === 'output') {
    // Output arrives in many small pieces; draw at most once a frame.
    if (!frame) frame = requestAnimationFrame(() => ((frame = 0), renderHead(), renderDetail()));
    return;
  }
  if (what === 'start') {
    clearInterval(clockTimer);
    clockTimer = setInterval(renderHead, 1000);
  }
  if (what === 'done' || what === 'reset') clearInterval(clockTimer);
  renderList();
  renderDetail();
}

function finished(done) {
  const { results } = runner;
  try {
    // A panel may leave something beneath a test that now passes: draw the detail again.
    if (results.ran && prunePanels([...results.tests, ...results.errors])) view.shown = null;
    const selected = view.selectedId && findResult(view.selectedId);
    if (!selected && !view.output) {
      // Collection errors come first: until a file imports, none of its tests can run.
      const [first] = failures();
      first && !results.problem ? select(first) : renderDetail();
    } else if (!view.shown) renderDetail();
  } finally {
    emit('tests:finished', { tests: [], errors: [], ...done });
  }
}

/**
 * The latest results, merged across runs:
 * { running, tests, errors, problem, summary, cancelled, complete, stale: [ids], unreached: [ids],
 * counts }. Tests and errors are the backend's result objects (see src-tauri/src/pytest/report.rs);
 * `id` is pytest's node id. `stale` ran before a file was saved; `unreached` are kept from an
 * earlier run because the last one stopped before reaching them.
 */
export function latestResults() {
  const { run, results } = runner;
  return {
    running: run.active,
    tests: [...results.tests],
    errors: [...results.errors],
    problem: results.problem,
    summary: results.summary,
    cancelled: results.cancelled,
    complete: results.complete,
    stale: [...results.stale],
    unreached: [...results.unreached],
    counts: count([...results.tests, ...results.errors]),
  };
}

// ---- keyboard ----

const level = (row) => Number(row.getAttribute('aria-level'));

function navigate(event) {
  const row = event.target.closest('.tests-row');
  if (!row) return;
  const all = [...rows.querySelectorAll('.tests-row')];
  const i = all.indexOf(row);
  const go = (next) => {
    if (!next) return;
    event.preventDefault();
    view.focusKey = next.dataset.key;
    if (next.dataset.id) select(findResult(next.dataset.id), { focus: true });
    else renderList(true);
  };
  const expanded = row.getAttribute('aria-expanded');
  const onRow = event.target === row;
  if (event.key === 'ArrowDown') go(all[i + 1]);
  else if (event.key === 'ArrowUp') go(all[i - 1]);
  else if (event.key === 'ArrowRight' && expanded === 'false') (event.preventDefault(), row.click());
  else if (event.key === 'ArrowLeft' && expanded === 'true') (event.preventDefault(), row.click());
  else if (event.key === 'ArrowLeft') go(all.slice(0, i).findLast((other) => level(other) < level(row)));
  else if (onRow && event.key === 'Enter') {
    event.preventDefault();
    row.dataset.id ? runTests([row.dataset.id]) : row.click();
  } else if (onRow && event.key === ' ') (event.preventDefault(), row.click());
}

export function mount() {
  addBottomPane({ name: 'tests', label: ['Tests ', badge], body: pane, actions });
  runner.connect({ onChange: render, onDone: finished });
  render('reset');

  registerCommand('run-tests', () => runTests([]));
  registerCommand('run-tests-file', () => runFile());
  registerCommand('rerun-failed-tests', () => rerunFailed());
  registerCommand('cancel-tests', () => runner.cancel());
  on('editor:saved', (path) => runner.markStale(path, 'saved'));
  // A git checkout, a formatter, a script: changes outside the editor count too.
  on('files:changed', (paths) => {
    const hit = paths.filter(affectsTests);
    if (hit.length) runner.markStale(hit.length === 1 ? hit[0] : '', 'changed');
  });
  on('workspace:opened', () => {
    disposeAll();
    Object.assign(view, { selectedId: null, output: false, focusKey: null, shown: null });
    announce(null);
    runner.reset();
  });
}
