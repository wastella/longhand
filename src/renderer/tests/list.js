// The left side of the test pane: where the run is, then the results grouped by file.

import { emptyState, h } from '../dom.js';
import { askTutorAbout } from '../tutor/index.js';
import { clock, count, duration, failed, group, parseId, shortName, slow } from './model.js';

/** Group key → open, for groups the student opened or closed themselves. */
const opened = new Map();

// Help with a failure starts from the student's own read of it.
function askAbout(test) {
  const output = (test.detail || test.message || '').slice(0, 6000);
  askTutorAbout({
    kind: 'failure',
    label: test.id.split('::').pop(),
    text: `Failing test: ${test.id}\n\nPytest output:\n${output}`,
    placeholder: 'What did you expect to happen, and what have you tried so far?',
  });
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "3 failed · 12 passed · 1 skipped", for a summary or a group. */
function tally(tests) {
  const c = count(tests);
  const parts = [
    c.failed && h('span', { class: 'tests-fail' }, `${c.failed} failed`),
    c.errors && h('span', { class: 'tests-fail' }, plural(c.errors, 'error')),
    c.passed && `${c.passed} passed`,
    c.skipped && `${c.skipped} skipped`,
    c.xfailed && `${c.xfailed} xfailed`,
    c.xpassed && `${c.xpassed} xpassed`,
  ].filter(Boolean);
  // Each count stays whole when the tally wraps.
  return parts.map((part) => h('span', { class: 'tests-tally-part' }, part)).flatMap((part, i) => (i ? [' · ', part] : [part]));
}

/** The top line: progress while running, the tally after. */
export function summary({ run, results, tests, errors, onShowOutput, onRunStale, outputShown }) {
  const lines = [];
  if (run.active) {
    const done = run.tests.length + run.errors.length;
    const of = run.total != null ? ` of ${run.total}` : '';
    const head = run.started ? `Running ${done}${of}` : 'Starting';
    lines.push(h('div', { class: 'tests-summary-line' }, h('span', {}, head), h('span', { class: 'dim tests-clock' }, clock(Date.now() - run.startedAt))));
    const now = run.current ? shortName({ id: run.current }) : run.started ? 'Collecting tests…' : lastLine(run.output) || 'Preparing the environment…';
    lines.push(h('div', { class: 'tests-summary-now dim', title: run.current || '' }, now));
    if (run.total)
      lines.push(h('div', { class: 'tests-progress' }, h('div', { class: 'tests-progress-bar', style: `width: ${Math.min(100, (100 * done) / run.total)}%` })));
    // Some runs never say how many tests there are (pytest-xdist, for one): progress without an end.
    else if (run.started && run.total == null)
      lines.push(
        h('div', { class: 'tests-progress indeterminate', role: 'progressbar', 'aria-label': 'Running tests' }, h('div', { class: 'tests-progress-bar' })),
      );
  } else {
    const shown = tally([...tests, ...errors]);
    const took = results.summary.match(/ in ([\d.]+)s$/);
    const time = took && (duration(Number(took[1])) || `${took[1]}s`);
    lines.push(
      h(
        'div',
        { class: 'tests-summary-line' },
        h(
          'span',
          { class: 'tests-tally', title: results.summary },
          results.cancelled && h('span', { class: 'dim' }, 'Stopped · '),
          !results.cancelled && results.problem?.kind === 'stopped-early' && h('span', { class: 'dim' }, 'Incomplete · '),
          shown.length ? shown : 'No results',
          time && h('span', { class: 'dim' }, ` in ${time}`),
        ),
        h(
          'button',
          {
            type: 'button',
            class: `ghost${outputShown ? ' active' : ''}`,
            id: 'tests-show-output',
            'aria-pressed': String(outputShown),
            onclick: onShowOutput,
          },
          'Output',
        ),
      ),
    );
    const failedImports = errors.filter((e) => e.phase === 'collect').length;
    if (failedImports && !tests.length)
      lines.push(h('div', { class: 'tests-summary-note' }, `${plural(failedImports, 'test file')} could not be imported, so no tests ran.`));
    if (results.unreached.size) {
      const n = results.unreached.size;
      lines.push(
        h(
          'div',
          { class: 'tests-summary-stale' },
          h('span', {}, `${plural(n, 'result')} ${n === 1 ? 'is' : 'are'} from an earlier run: this one stopped before ${n === 1 ? 'it' : 'them'}.`),
          !results.stale.size && h('button', { type: 'button', class: 'ghost', id: 'tests-run-stale', onclick: onRunStale }, 'Run again'),
        ),
      );
    }
    if (results.stale.size) {
      const file = results.staleFile?.path?.split('/').pop();
      const when = results.stale.size === tests.length + errors.length ? 'this run' : 'some of these ran';
      const what =
        results.staleFile?.how === 'changed'
          ? `${file ? `${file} changed` : 'Files changed'} on disk after ${when}.`
          : `You saved ${file || 'a file'} after ${when}.`;
      lines.push(
        h(
          'div',
          { class: 'tests-summary-stale' },
          h('span', {}, what),
          h('button', { type: 'button', class: 'ghost', id: 'tests-run-stale', onclick: onRunStale }, 'Run again'),
        ),
      );
    }
  }
  return h('div', { class: 'tests-summary' }, lines);
}

/** The last line pytest (or uv, while it prepares the environment) printed. */
function lastLine(output) {
  const lines = output.trimEnd().split('\n');
  return lines.at(-1).slice(0, 200);
}

/** An environment problem in plain words, with the command that fixes it. */
export function problemNotice(problem) {
  const copy = (button, text) => navigator.clipboard?.writeText(text).then(() => (button.textContent = 'Copied'));
  return h(
    'div',
    { class: 'tests-problem', role: 'alert' },
    h('p', { class: 'tests-problem-title' }, problem.title),
    h('p', {}, problem.detail),
    problem.fix && h('p', { class: 'dim' }, 'In the terminal:'),
    problem.fix &&
      h(
        'div',
        { class: 'tests-fix' },
        h('code', {}, problem.fix),
        h('button', { type: 'button', class: 'ghost', onclick: (e) => copy(e.currentTarget, problem.fix) }, 'Copy'),
      ),
  );
}

function isOpen(item, only) {
  if (opened.has(item.key)) return opened.get(item.key);
  return only || item.tests.some(failed) || item.tests.some((t) => t.status === 'RUNNING');
}

/**
 * The results as a tree of rows. `on` has `select(test)`, `run(targets)` and `rerender()`.
 * A row's `data-key` stays the same across renders, so focus and selection survive them.
 */
export function tree({ tests, staleIds, on }) {
  if (!tests.length) return [];
  const groups = group(tests);
  const rows = [];
  for (const file of groups) {
    const open = isOpen(file, groups.length === 1);
    rows.push(groupRow(file, open, 0, on, [file.key]));
    if (!open) continue;
    for (const item of file.items) {
      if (!item.items) {
        rows.push(testRow(item, 1, { staleIds, on }));
        continue;
      }
      const fnOpen = isOpen(item, false);
      rows.push(groupRow(item, fnOpen, 1, on, [item.key]));
      if (fnOpen) for (const test of item.items) rows.push(testRow(test, 2, { staleIds, on, label: parseId(test.id).params }));
    }
  }
  return rows;
}

function groupRow(item, open, depth, on, targets) {
  const toggle = () => (opened.set(item.key, !open), on.rerender(item.key));
  const tests = item.tests.filter((t) => t.status !== 'RUNNING');
  const c = count(tests);
  const bad = c.failed + c.errors;
  return h(
    'div',
    {
      class: `tests-row tests-group list-row depth-${depth}`,
      role: 'treeitem',
      'aria-expanded': String(open),
      'aria-level': String(depth + 1),
      tabindex: '-1',
      'data-key': item.key,
      title: item.key,
      onclick: toggle,
    },
    h('span', { class: 'twist' }, open ? '▾' : '▸'),
    h('span', { class: 'name' }, item.label),
    h('span', { class: 'tests-count' }, bad ? [h('span', { class: 'tests-fail' }, `${bad} failing`), ` of ${tests.length}`] : `${tests.length}`),
    h(
      'button',
      { type: 'button', class: 'ghost tests-row-run', tabindex: '-1', title: `Run ${item.label}`, onclick: (e) => (e.stopPropagation(), on.run(targets)) },
      'Run',
    ),
  );
}

/** A test's name; in a class, the class gives way first when space is short. */
function testName(test) {
  const { classes, func, params } = parseId(test.id);
  if (!classes.length || test.phase === 'collect') return h('span', { class: 'name' }, shortName(test));
  return h(
    'span',
    { class: 'name tests-name-split' },
    h('span', { class: 'tests-name-class' }, `${classes.join(' › ')} › `),
    h('span', { class: 'tests-name-func' }, func + params),
  );
}

function testRow(test, depth, { staleIds, on, label }) {
  const running = test.status === 'RUNNING';
  const took = duration(test.duration);
  const row = h(
    'div',
    {
      class: `tests-row test list-row depth-${depth} ${test.status}${staleIds.has(test.id) ? ' stale' : ''}`,
      role: 'treeitem',
      'aria-level': String(depth + 1),
      tabindex: '-1',
      'data-key': test.id,
      'data-id': running ? null : test.id,
      title: test.id,
      onclick: () => !running && on.select(test),
    },
    h('span', { class: 'dot' }),
    label ? h('span', { class: 'name' }, label) : testName(test),
    running ? h('span', { class: 'tests-time dim' }, 'running') : took && h('span', { class: `tests-time${slow(test) ? ' slow' : ''}` }, took),
  );
  // "Ask tutor" stays the first button on a failing row; other areas and the README screenshot rely on it.
  if (failed(test)) row.append(h('button', { type: 'button', tabindex: '-1', onclick: (e) => (e.stopPropagation(), askAbout(test)) }, 'Ask tutor'));
  if (!running) {
    row.append(
      h(
        'button',
        { type: 'button', class: 'ghost tests-row-run', tabindex: '-1', title: 'Run this test', onclick: (e) => (e.stopPropagation(), on.run([test.id])) },
        'Run',
      ),
    );
  }
  return row;
}

/** What the list shows before any run. */
export function firstRun() {
  return [
    emptyState('Run the tests to see results here.'),
    h('p', { class: 'tests-keys dim' }, '⌘⇧T runs every test, ⌘T the open test file, ⌘⇧Y the failed ones again.'),
  ];
}
