import assert from 'node:assert/strict';
import { withDummyPanel } from '../../scripts/scenarios/tests-failure-panel.mjs';
import { count, openFromTree, sleep, text, uiTest } from './helpers.mjs';

const runAll = (page) => page.evaluate(() => window.__emit('menu', 'run-tests'));
const menu = (page, id) => page.evaluate((command) => window.__emit('menu', command), id);
const finished = (page) => page.waitForFunction(() => !document.querySelector('#cancel-tests') || document.querySelector('#cancel-tests').hidden);
const lastRun = (page) => page.evaluate(() => window.__testRuns.at(-1));
const names = (page) => page.$$eval('#tests-rows .tests-row .name', (n) => n.map((x) => x.textContent));

uiTest('shows test results with failures first and the failure beside them', async (page) => {
  await page.evaluate(() => document.querySelector('#run-all-tests').click());
  await page.waitForSelector('#tests-rows .test.FAILED');
  await finished(page);
  assert.deepEqual(await names(page), ['tests/test_running.py', 'test_variance', 'test_mean']);
  assert.equal(await text(page, '#tests-badge'), '1 failing');
  assert.match(await text(page, '.tests-tally'), /1 failed · 1 passed/);
  assert.match(await text(page, '#tests-detail .tests-message'), /assert 6\.0 == 4\.0\n\s*\+\s+where 6\.0 = variance\(\)/);
  assert.equal(await count(page, '#tests-rows .test.FAILED button'), 2, 'Ask tutor and Run');
  assert.equal(await text(page, '#tests-rows .test.FAILED button'), 'Ask tutor', 'Ask tutor stays the first button');
  assert.deepEqual(await lastRun(page), []);
});

uiTest('a path in the traceback opens the file at that line', async (page) => {
  await runAll(page);
  await page.waitForSelector('#tests-detail .tests-frame .tests-loc');
  await page.click('#tests-detail .tests-frame .tests-loc');
  await page.waitForFunction(() => document.querySelector('#status-file').textContent === 'tests/test_running.py');
  assert.match(await text(page, '#status-pos'), /Ln 15\b/);
});

uiTest(
  'shows progress while running, and Escape in the pane stops the run',
  async (page) => {
    await runAll(page);
    await page.waitForSelector('#tests-rows .test.RUNNING');
    assert.match(await text(page, '.tests-summary-line'), /Running 9 of 15/);
    assert.equal(await text(page, '.tests-summary-now'), 'test_gradient_clipping');
    assert.equal(await text(page, '#tests-badge'), '9/15');
    assert.equal(await page.$eval('#cancel-tests', (n) => n.hidden), false);
    await page.focus('#tests-rows .tests-row');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#cancel-tests[hidden]');
    assert.match(await text(page, '.tests-tally'), /^Stopped · 3 failed · 1 error · 5 passed/);
    assert.equal(await count(page, '#tests-rows .test.RUNNING'), 0);
  },
  { testsSuite: 'course', testsHangAfter: 9, testsDelay: 1 },
);

const setOptions = (page, options) => page.evaluate((o) => Object.assign(window.__MOCK__, o), options);
const shownStatuses = (page) =>
  page.$$eval('#tests-rows .test', (rows) =>
    rows.map((r) => `${r.className.match(/ (PASSED|FAILED|ERROR|SKIPPED|XFAIL|XPASS)/)?.[1]} ${r.dataset.id}${r.classList.contains('stale') ? ' stale' : ''}`),
  );

uiTest(
  'a run that crashes partway is never shown as passing, and keeps what it did not reach',
  async (page) => {
    await runAll(page);
    await finished(page);
    await setOptions(page, { testsCrashAfter: 1, testOutcomes: { 'tests/test_running.py::test_variance': 'PASSED' } });
    // A run where everything it reported passed, but the process died on the next test.
    await page.evaluate(() => window.__emit('menu', 'run-tests'));
    await page.waitForSelector('.tests-problem');
    assert.equal(await text(page, '.tests-problem-title'), 'pytest stopped before the run finished');
    assert.deepEqual(await shownStatuses(page), ['ERROR tests/test_running.py::test_variance', 'PASSED tests/test_running.py::test_mean']);
    assert.notEqual(await text(page, '#tests-badge'), 'passing');
    assert.match(await text(page, '.tests-tally'), /^Incomplete · 1 error · 1 passed/);
    await page.click('#tests-rows .test.ERROR');
    assert.match(await text(page, '#tests-detail .tests-message'), /process ended while this test was running \(signal 11/);

    // Stopped after one result: the other test keeps its earlier result, marked out of date.
    await setOptions(page, { testsCrashAfter: null, testsHangAfter: 1, testOutcomes: {} });
    await runAll(page);
    await page.waitForFunction(() => document.querySelector('.tests-summary-line')?.textContent.startsWith('Running 1'));
    await menu(page, 'cancel-tests');
    await finished(page);
    assert.deepEqual(await shownStatuses(page), ['ERROR tests/test_running.py::test_variance stale', 'PASSED tests/test_running.py::test_mean']);
    assert.match(await text(page, '.tests-summary-stale'), /1 result is from an earlier run/);
    assert.equal(await text(page, '#tests-badge'), '1 failing');
  },
  { testsDelay: 1 },
);

uiTest(
  'a run that never says how many tests there are shows progress without an end',
  async (page) => {
    await runAll(page);
    await page.waitForSelector('#tests-rows .test.RUNNING');
    assert.equal(await count(page, '.tests-progress.indeterminate'), 1);
    assert.equal(await text(page, '.tests-summary-line > span'), 'Running 2');
    assert.equal(await text(page, '#tests-badge'), '2');
  },
  { testsSuite: 'course', testsHangAfter: 2, testsNoTotal: true, testsDelay: 1 },
);

uiTest('events from a stopped run never reach the next one', async (page) => {
  await setOptions(page, { testsHangAfter: 0 });
  await runAll(page);
  await page.waitForSelector('#tests-rows .test.RUNNING');
  const old = await page.evaluate(() => window.__testRunToken?.() ?? null);
  await menu(page, 'cancel-tests');
  await finished(page);
  await setOptions(page, { testsHangAfter: null });
  await runAll(page);
  await finished(page);
  // The stopped run's last words arrive late, with its own id.
  await page.evaluate((run) => {
    const test = { id: 'tests/test_running.py::test_ghost', status: 'PASSED', duration: 0, path: '', frames: [], sections: [] };
    window.__emit('tests:progress', { run, updates: [{ type: 'result', test }] });
    window.__emit('tests:done', { run, tests: [test], errors: [], complete: true, collected: [test.id] });
  }, old);
  assert.deepEqual(await names(page), ['tests/test_running.py', 'test_variance', 'test_mean']);
});

uiTest('a test that no longer exists drops out after a complete run, but not after a stopped one', async (page) => {
  await withDummyPanel(page);
  await runAll(page);
  await page.waitForSelector('.dummy-panel');
  await finished(page);
  await setOptions(page, { testsGone: ['tests/test_running.py::test_variance'], testsHangAfter: 0 });
  await runAll(page);
  await page.waitForSelector('#tests-rows .test.RUNNING');
  await menu(page, 'cancel-tests');
  await finished(page);
  assert.deepEqual(await page.evaluate(() => window.__panels.disposed), [], 'a stopped run disposes nothing');
  await setOptions(page, { testsHangAfter: null });
  await menu(page, 'rerun-failed-tests');
  await page.waitForFunction(() => window.__panels.disposed.length === 1);
  await finished(page);
  assert.deepEqual(await lastRun(page), ['tests/test_running.py::test_variance']);
  // test_mean keeps its result, still out of date: the stopped run never reached it.
  assert.deepEqual(await shownStatuses(page), ['PASSED tests/test_running.py::test_mean stale']);
  assert.deepEqual(await page.evaluate(() => window.__panels.disposed), [['tests/test_running.py::test_variance', 'dummy-panel']]);
});

uiTest('one result per test, even when pytest reports a test twice', async (page) => {
  await setOptions(page, { testsHangAfter: 0 });
  await runAll(page);
  await page.waitForSelector('#tests-rows .test.RUNNING');
  const run = await page.evaluate(() => window.__testRunToken());
  await page.evaluate((run) => {
    const test = (status) => ({
      id: 'tests/test_running.py::test_mean',
      status,
      duration: 0,
      path: 'tests/test_running.py',
      frames: [],
      sections: [],
      message: '',
    });
    window.__emit('tests:progress', {
      run,
      updates: [
        { type: 'result', test: test('FAILED') },
        { type: 'result', test: test('PASSED') },
      ],
    });
  }, run);
  await page.waitForFunction(() => document.querySelectorAll('#tests-rows .test.PASSED').length === 1);
  assert.equal(await count(page, '#tests-rows .test[data-id="tests/test_running.py::test_mean"]'), 1);
});

uiTest(
  'groups by file and parameterised function, failures first, passing files folded',
  async (page) => {
    await runAll(page);
    await finished(page);
    const groups = await page.$$eval('#tests-rows .tests-group.depth-0', (n) =>
      n.map((x) => [x.querySelector('.name').textContent, x.getAttribute('aria-expanded'), x.querySelector('.tests-count').textContent]),
    );
    assert.deepEqual(groups, [
      ['tests/test_model.py', 'true', '4 failing of 7'],
      ['tests/test_nn_utils.py', 'false', '3'],
      ['tests/test_tokenizer.py', 'false', '5'],
    ]);
    const params = await page.$$eval('#tests-rows .test.depth-2 .name', (n) => n.map((x) => x.textContent));
    assert.deepEqual(params, ['[mask1]', '[mask0]'], 'the failing case first');
    // Keyboard: open the tokenizer file and see its slow test's duration.
    await page.focus('#tests-rows .tests-group[data-key="tests/test_tokenizer.py"]');
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('#tests-rows .tests-group[data-key="tests/test_tokenizer.py"][aria-expanded="true"]');
    assert.equal(await text(page, '.test[data-id="tests/test_tokenizer.py::test_tinystories_matches_tiktoken"] .tests-time.slow'), '3.42s');
    await page.keyboard.press('ArrowDown');
    assert.equal(await text(page, '#tests-detail .tests-detail-name'), 'test_roundtrip_empty');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'tests/test_tokenizer.py::test_roundtrip_empty');
  },
  { testsSuite: 'course', testsDelay: 1 },
);

uiTest(
  'failure detail: library frames folded, captured output collapsed, long text cut short',
  async (page) => {
    await runAll(page);
    await finished(page);
    assert.equal(await text(page, '#tests-detail .tests-detail-name'), 'test_linear', 'the first failure is selected');
    assert.match(await text(page, '#tests-detail .tests-hint'), /starter code/);
    assert.match(await text(page, '#tests-detail .tests-at'), /tests\/adapters\.py:31 in run_linear/);
    const section = '#tests-detail .tests-section';
    assert.match(await text(page, `${section} summary`), /Captured stdout · 150 lines/);
    assert.equal(await page.$eval(section, (n) => n.open), false);
    await page.click(`${section} summary`);
    await page.click(`${section} .tests-more`);
    assert.match(await text(page, `${section} pre`), /step 149: loss/);

    await page.click('#tests-rows .test[data-id="tests/test_model.py::test_embedding"]');
    assert.equal(await count(page, '#tests-detail .tests-frame.own'), 1);
    assert.match(await text(page, '#tests-detail .tests-library summary'), /3 frames in library code/);
    assert.equal(await page.$eval('#tests-detail .tests-library', (n) => n.open), false);
  },
  { testsSuite: 'course', testsDelay: 1 },
);

uiTest('runs one test from its row and keeps the other results', async (page) => {
  await runAll(page);
  await finished(page);
  await page.click('#tests-rows .test[data-id="tests/test_running.py::test_mean"] .tests-row-run');
  await finished(page);
  assert.deepEqual(await lastRun(page), ['tests/test_running.py::test_mean']);
  assert.deepEqual(await names(page), ['tests/test_running.py', 'test_variance', 'test_mean']);
  assert.equal(await text(page, '#tests-badge'), '1 failing');
});

uiTest('runs the open test file, and only test files', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await menu(page, 'run-tests-file');
  assert.match(await text(page, '#status-msg'), /Open a test file/);
  await openFromTree(page, 'tests/test_running.py');
  await menu(page, 'run-tests-file');
  await page.waitForSelector('#tests-rows .test.FAILED');
  assert.deepEqual(await lastRun(page), ['tests/test_running.py']);
});

uiTest('reruns only the failing tests', async (page) => {
  await menu(page, 'rerun-failed-tests');
  assert.match(await text(page, '#status-msg'), /Run the tests first/);
  await runAll(page);
  await finished(page);
  await menu(page, 'rerun-failed-tests');
  await finished(page);
  assert.deepEqual(await lastRun(page), ['tests/test_running.py::test_variance']);
});

uiTest(
  'explains a missing tool and how to install it',
  async (page) => {
    await runAll(page);
    await page.waitForSelector('.tests-problem');
    assert.equal(await text(page, '.tests-problem-title'), 'uv is not installed');
    assert.equal(await text(page, '.tests-fix code'), 'curl -LsSf https://astral.sh/uv/install.sh | sh');
    assert.match(await text(page, '#tests-detail'), /command not found: uv/, 'the output is beside it');
  },
  { testsProblem: 'no-uv' },
);

uiTest(
  'says so when the folder is not a Python project',
  async (page) => {
    await runAll(page);
    await page.waitForSelector('.tests-problem');
    assert.equal(await text(page, '.tests-problem-title'), 'This folder has no Python code');
  },
  { testsProblem: 'not-python' },
);

uiTest(
  'shows a test file that fails to import, with the error',
  async (page) => {
    await runAll(page);
    await page.waitForSelector('#tests-detail .tests-message');
    assert.equal(await text(page, '#tests-detail .tests-message'), "ModuleNotFoundError: No module named 'stats.runing'");
    assert.match(await text(page, '.tests-summary-note'), /1 test file could not be imported/);
    assert.equal(await text(page, '#tests-rows .test.ERROR .name'), 'Could not be imported');
  },
  { testsProblem: 'collect-error' },
);

uiTest(
  'a file that cannot be saved stops the run, rather than testing the old code',
  async (page) => {
    await runAll(page);
    await finished(page);
    await openFromTree(page, 'stats/running.py');
    await page.click('.cm-content');
    await page.keyboard.type('# fix');
    const runs = await page.evaluate(() => window.__testRuns.length);
    await runAll(page);
    await page.waitForSelector('.tests-problem');
    assert.equal(await text(page, '.tests-problem-title'), 'The tests did not run: a file could not be saved');
    assert.equal(await page.evaluate(() => window.__testRuns.length), runs, 'pytest was not started');
    assert.equal(await text(page, '#tests-badge'), '1 failing', 'the earlier results stay');
  },
  { readOnly: ['stats/running.py'] },
);

uiTest('results go stale when code changes on disk outside the editor, but not for caches', async (page) => {
  await runAll(page);
  await finished(page);
  const batch = (paths) => page.evaluate((paths) => window.__emit('files:changed', { root: '/demo/running-stats', paths }), paths);
  await batch(['.pytest_cache/v/cache/lastfailed', 'tests/__pycache__/test_running.cpython-312.pyc', '.longhand/log.jsonl', 'notes.md']);
  await sleep(100);
  assert.equal(await count(page, '#tests-rows .test.stale'), 0);
  await batch(['stats/running.py']);
  await page.waitForSelector('#tests-run-stale');
  assert.equal(await count(page, '#tests-rows .test.stale'), 2);
  assert.match(await text(page, '.tests-summary-stale'), /running\.py changed on disk after this run/);
});

uiTest('results go stale when a file is saved after the run', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await runAll(page);
  await finished(page);
  assert.equal(await count(page, '#tests-rows .test.stale'), 0);
  await page.click('.cm-content');
  await page.keyboard.type('# fix');
  await menu(page, 'save');
  await page.waitForSelector('#tests-run-stale');
  assert.equal(await count(page, '#tests-rows .test.stale'), 2);
  assert.match(await text(page, '.tests-summary-stale'), /You saved running\.py after this run/);
  assert.match(await page.$eval('#tests-badge', (n) => n.className), /stale/);
  await page.click('#tests-run-stale');
  await page.waitForFunction(() => !document.querySelector('#tests-run-stale'));
  await finished(page);
  assert.deepEqual(await lastRun(page), []);
  assert.equal(await count(page, '#tests-rows .test.stale'), 0);
});

uiTest('the raw output is a click away', async (page) => {
  await runAll(page);
  await finished(page);
  await page.click('#tests-show-output');
  assert.match(await text(page, '#tests-detail .tests-raw'), /test session starts[\s\S]*test_variance FAILED/);
  assert.match(await text(page, '#tests-detail .tests-command'), /\$ uv run pytest/);
  await page.click('#tests-rows .test.FAILED');
  assert.equal(await count(page, '#tests-detail .tests-raw'), 0);
});

uiTest('a panel attached to a failure lasts while it fails and goes when it passes', async (page) => {
  await withDummyPanel(page);
  await runAll(page);
  await page.waitForSelector('.tests-failure-panel .dummy-panel');
  await page.type('.dummy-panel textarea', 'my notes');
  assert.deepEqual(await page.evaluate(() => window.__panels.selected), ['tests/test_running.py::test_variance']);

  await page.click('#tests-rows .test.PASSED');
  assert.equal(await count(page, '.dummy-panel'), 0, 'only beneath the failing test');
  await runAll(page);
  await finished(page);
  await page.click('#tests-rows .test.FAILED');
  assert.equal(await page.$eval('.dummy-panel textarea', (n) => n.value), 'my notes', 'the same panel after a rerun');
  assert.deepEqual(await page.evaluate(() => window.__panels.made), ['tests/test_running.py::test_variance']);

  const latest = await page.evaluate(() => window.__latestResults());
  assert.equal(latest.running, false);
  assert.deepEqual(
    latest.tests.map((t) => `${t.status} ${t.id}`),
    ['PASSED tests/test_running.py::test_mean', 'FAILED tests/test_running.py::test_variance'],
  );

  await page.evaluate(() => (window.__MOCK__.testOutcomes = { 'tests/test_running.py::test_variance': 'PASSED' }));
  await runAll(page);
  await page.waitForFunction(() => window.__panels.disposed.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__panels.disposed), [['tests/test_running.py::test_variance', 'dummy-panel']]);
  assert.equal(await text(page, '#tests-badge'), 'passing');
});

uiTest('the failure panel hears when its failure changes, and the selection is announced', async (page) => {
  await withDummyPanel(page);
  await runAll(page);
  await page.waitForSelector('.dummy-panel');
  await finished(page);
  // The same failure again: nothing to tell. A different failure: update.
  await runAll(page);
  await finished(page);
  assert.deepEqual(await page.evaluate(() => window.__panels.updated), []);
  await setOptions(page, { testOutcomes: { 'tests/test_running.py::test_variance': 'ERROR' } });
  await runAll(page);
  await finished(page);
  assert.deepEqual(await page.evaluate(() => window.__panels.updated), [['tests/test_running.py::test_variance', 'ERROR', 'dummy-panel']]);
  const variance = 'tests/test_running.py::test_variance';
  assert.deepEqual(await page.evaluate(() => window.__panels.selected), [variance, variance, variance], 'each new result is announced');
  await page.evaluate(() => window.__mock.emit('workspace:opened', window.__mock.workspace));
  await page.waitForFunction(() => window.__panels.selected.at(-1) === null);
  assert.equal(await page.evaluate(() => window.__panels.disposed.length), 1, 'a new folder disposes the panel');
});

uiTest('a failure panel that throws cannot break the test pane', async (page) => {
  await withDummyPanel(page);
  await page.evaluate(() => {
    window.__unregisterPanel();
    window.__unregisterPanel(); // a second call does nothing
    window.__finishedRuns = 0;
    window.__on('tests:finished', () => window.__finishedRuns++);
    window.__unregisterBroken = window.__registerFailurePanel(
      () => document.createElement('div'),
      () => {
        throw new Error('dispose broke');
      },
    );
  });
  await runAll(page);
  await finished(page);
  assert.equal(await count(page, '.tests-failure-panel'), 1);
  await setOptions(page, { testOutcomes: { 'tests/test_running.py::test_variance': 'PASSED' } });
  await runAll(page);
  await finished(page);
  assert.equal(await text(page, '#tests-badge'), 'passing');
  assert.equal(await page.evaluate(() => window.__finishedRuns), 2, 'tests:finished still announced');

  // A panel that throws while rendering: the failure still shows, without a panel.
  await page.evaluate(() => {
    window.__unregisterBroken();
    window.__registerFailurePanel(() => {
      throw new Error('render broke');
    });
  });
  await setOptions(page, { testOutcomes: {} });
  await runAll(page);
  await finished(page);
  assert.match(await text(page, '#tests-detail .tests-message'), /assert 6\.0 == 4\.0/);
  assert.equal(await count(page, '.tests-failure-panel'), 0);
});
