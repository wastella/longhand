import assert from 'node:assert/strict';
import { count, openFromTree, sleep, text, uiTest } from './helpers.mjs';

const RUNNING = 'stats/running.py';
/** The fixture's stats/running.py. */
const RUNNING_TEXT = [
  '"""Statistics over a stream of numbers, without storing the stream."""',
  '',
  '',
  'class RunningStats:',
  '    def __init__(self) -> None:',
  '        self.count = 0',
  '        self.mean = 0.0',
  '        self.sum_sq = 0.0',
  '',
  '    def push(self, x: float) -> None:',
  '        self.count += 1',
  '        delta = x - self.mean',
  '        self.mean += delta / self.count',
  '        self.sum_sq += delta * delta',
  '',
  '    def variance(self) -> float:',
  '        if self.count < 2:',
  '            return 0.0',
  '        return self.sum_sq / (self.count - 1)',
  '',
].join('\n');
const asked = (page) => page.evaluate(() => window.__asked);
const lastAsked = (page) => page.evaluate(() => window.__asked.at(-1));
const notesOn = (page, source = 'review', path = RUNNING) => page.evaluate((s, p) => window.__editor.notesOn(s, p), source, path);
const setOptions = (page, options) => page.evaluate((o) => Object.assign(window.__MOCK__, o), options);
const kept = (page) => page.evaluate(() => window.__notes);
const idle = (page) => page.waitForFunction(() => !document.querySelector('.msg.tutor.streaming') && !document.querySelector('#fb-summary .fb-status.running'));
const runTests = (page) => page.evaluate(() => window.__emit('menu', 'run-tests'));
const testsDone = (page) => page.waitForFunction(() => !document.querySelector('#cancel-tests') || document.querySelector('#cancel-tests').hidden);

async function review(page, rows) {
  await page.evaluate(() => window.__emit('menu', 'review-file'));
  await page.waitForFunction((n) => document.querySelectorAll('#fb-summary .fb-list .fb-row').length === n, {}, rows);
  await idle(page);
}

/** Opens the note on `line` from the Notes list. */
async function openNote(page, line) {
  const rows = await page.$$eval('#fb-summary .fb-list .fb-row-lines', (n) => n.map((x) => x.textContent));
  await page.click(`#fb-summary .fb-list .fb-row:nth-child(${rows.findIndex((r) => r.startsWith(String(line))) + 1}) button`);
  await page.waitForSelector('.cm-note .fb-note');
}

async function selectLines(page, from, lines) {
  await page.click(`.cm-line:nth-child(${from})`);
  await page.keyboard.press('Home');
  await page.keyboard.press('Home');
  for (let i = 0; i < lines; i++) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Shift');
  }
}

// ---- review as margin notes ----

uiTest('a review saves the file and pins its notes to the lines they are about', async (page) => {
  await openFromTree(page, RUNNING);
  await page.click('.cm-line:nth-child(20)');
  await page.keyboard.type('# draft');
  await review(page, 3);
  assert.equal(await page.evaluate(() => window.__saves['stats/running.py']), 1, 'saved before the review');
  const sent = await lastAsked(page);
  assert.deepEqual([sent.kind, sent.about, sent.ephemeral], ['review', 'review', true]);
  assert.match(sent.prompt, /<context>\nFile: stats\/running\.py \(20 lines\)[\s\S]*\n12 {2}        delta = x - self\.mean\n[\s\S]*20 {2}# draft\n<\/context>/);
  assert.deepEqual(
    (await notesOn(page)).map(({ fromLine, toLine }) => [fromLine, toLine]),
    [
      [5, 8],
      [12, 14],
      [17, 18],
    ],
  );
  assert.match(await text(page, '#fb-summary .fb-summary-head'), /Notes\s*3 open/);
  assert.match(await text(page, '#status-msg'), /3 notes on running\.py/);
  // Nothing opens by itself, and the cursor stays where the student left it.
  assert.equal(await count(page, '.cm-note'), 0);
  assert.match(await text(page, '#status-pos'), /Ln 20, Col 8/);

  await openNote(page, 12);
  assert.match(await text(page, '.cm-note .fb-note-kind'), /Question/);
  assert.match(await text(page, '.cm-note .fb-remark'), /You update mean before adding to sum_sq/);
  const saved = await kept(page);
  assert.equal(saved.length, 3);
  assert.deepEqual(saved[1].anchor, ['        delta = x - self.mean', '        self.mean += delta / self.count', '        self.sum_sq += delta * delta']);
});

uiTest(
  'malformed review output is tolerated: only notes that fit the file are placed, and markup is sanitized',
  async (page) => {
    await openFromTree(page, RUNNING);
    await review(page, 2);
    assert.deepEqual(
      (await notesOn(page)).map(({ fromLine, toLine }) => [fromLine, toLine]),
      [
        [12, 14],
        [17, 17],
      ],
    );
    await openNote(page, 17);
    assert.match(await text(page, '.cm-note .fb-note-kind'), /Question/, 'an unknown kind becomes a question');
    assert.equal(await count(page, '.cm-note img, .cm-note [onerror]'), 0);
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
  },
  { feedback: { review: 'malformed' } },
);

uiTest(
  'a review with no notes it can place says so and offers to try again',
  async (page) => {
    await openFromTree(page, RUNNING);
    await page.evaluate(() => window.__emit('menu', 'review-file'));
    await page.waitForSelector('#fb-summary .fb-status');
    await idle(page);
    assert.match(await text(page, '#fb-summary .fb-status'), /without notes the editor could place/);
    assert.equal((await notesOn(page)).length, 0);
  },
  { feedback: { review: 'prose' } },
);

uiTest(
  'a failed review shows why in place, with Retry, and leaves the notes it had',
  async (page) => {
    await openFromTree(page, RUNNING);
    await page.evaluate(() => window.__emit('menu', 'review-file'));
    await page.waitForSelector('#fb-summary .msg.error');
    assert.match(await text(page, '#fb-summary .msg.error'), /usage limit/);
    await page.click('#fb-summary .msg.error .retry');
    await page.waitForFunction(() => document.querySelectorAll('#fb-summary .fb-list .fb-row').length === 3);
  },
  { tutor: { failures: [{ code: 'rate-limited', message: 'Usage limit reached', resetsAt: Math.floor(Date.now() / 1000) + 3600 }] } },
);

uiTest(
  'a review in progress can be stopped; the notes placed so far stay',
  async (page) => {
    await openFromTree(page, RUNNING);
    await page.evaluate(() => window.__emit('menu', 'review-file'));
    await page.waitForFunction(() => document.querySelectorAll('#fb-summary .fb-list .fb-row').length === 1);
    assert.match(await text(page, '#fb-summary .fb-status.running'), /so far/);
    await page.click('#fb-summary .fb-status.running button');
    await idle(page);
    await sleep(300);
    assert.equal((await notesOn(page)).length, 1);
  },
  { feedback: { review: ['<note lines="5-8" kind="good">\nGood.\n</note>\n', '', '', '', '', '', '<note lines="12" kind="bug">Late.</note>'] } },
);

uiTest('a reply to a note continues a thread of its own, with the code around it', async (page) => {
  await openFromTree(page, RUNNING);
  await review(page, 3);
  await openNote(page, 12);
  await page.click('.cm-note .fb-reply-input');
  assert.match(await text(page, '.cm-note .fb-sees'), /The tutor sees this note, lines 12–14 of running\.py/);
  await page.type('.cm-note .fb-reply-input', 'why?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.cm-note .fb-thread .msg.tutor');
  await idle(page);
  const sent = await lastAsked(page);
  assert.deepEqual([sent.kind, sent.about, sent.question], ['review', 'review-reply', 'why?']);
  assert.match(sent.thread, /^note-/);
  assert.match(
    sent.prompt,
    /A margin note you wrote on stats\/running\.py, lines 12–14:\nYou update `mean`[\s\S]*The code around it now:\n 9 {2}\n[\s\S]*17 {2}/,
  );
  assert.match(await text(page, '.cm-note .fb-thread .msg.user'), /why\?/);
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('fb-reply-input')), true, 'focus stays in the note');
  assert.equal((await kept(page)).find((n) => n.fromLine === 12).replies, 1);

  // Escape goes back to the code.
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('cm-content')), true);
});

uiTest('resolving a note takes it out of the margin into the list; reopening puts it back; dismissing removes it', async (page) => {
  await openFromTree(page, RUNNING);
  await review(page, 3);
  await openNote(page, 12);
  await page.click('.cm-note .fb-action:nth-of-type(1)');
  assert.equal((await notesOn(page)).length, 2);
  assert.match(await text(page, '#fb-summary .fb-group.resolved summary'), /1 resolved/);
  assert.equal((await kept(page)).find((n) => n.fromLine === 12).status, 'resolved');

  await page.click('#fb-summary .fb-group.resolved summary');
  await page.click('#fb-summary .fb-group.resolved .fb-row button');
  await page.waitForSelector('.cm-note .fb-note');
  assert.equal((await notesOn(page)).length, 3);
  assert.equal((await kept(page)).find((n) => n.fromLine === 12).status, 'open');

  await page.click('.cm-note .fb-action:nth-of-type(2)');
  assert.deepEqual(
    (await notesOn(page)).map((n) => n.fromLine),
    [5, 17],
  );
  assert.equal((await kept(page)).length, 2);
});

uiTest('reviewing again replaces the open notes and keeps the resolved ones out of the way', async (page) => {
  await openFromTree(page, RUNNING);
  await review(page, 3);
  await openNote(page, 5);
  await page.click('.cm-note .fb-action:nth-of-type(1)');
  await setOptions(page, { feedback: { review: 'six' } });
  await page.click('#fb-review-again');
  await page.waitForFunction(() => document.querySelectorAll('#fb-summary .fb-list .fb-row').length === 6);
  await idle(page);
  const notes = await kept(page);
  assert.equal(notes.length, 7);
  assert.equal(notes.filter((n) => n.status === 'resolved').length, 1);
  assert.match(await text(page, '#fb-summary .fb-group.resolved summary'), /1 resolved/);
});

uiTest(
  'notes come back with the folder, follow code that moved, and are listed as outdated when it is gone',
  async (page) => {
    await openFromTree(page, RUNNING);
    await page.waitForSelector('#fb-summary .fb-list');
    // Two lines were added at the top while the app was closed.
    assert.deepEqual(
      (await notesOn(page)).map(({ id, fromLine, toLine }) => [id, fromLine, toLine]),
      [['moved', 14, 16]],
    );
    assert.match(await text(page, '#fb-summary .fb-group.outdated summary'), /1 note no longer matches the code/);
    await page.click('#fb-summary .fb-group.outdated summary');
    assert.match(await text(page, '#fb-summary .fb-group.outdated'), /About a line that is gone/);
    await page.click('#fb-summary .fb-group.outdated .fb-action');
    assert.equal(await count(page, '#fb-summary .fb-group.outdated'), 0);
    assert.deepEqual(
      (await kept(page)).map((n) => n.id),
      ['moved'],
    );
  },
  {
    files: { 'stats/running.py': `# Two lines added\n# while the app was closed\n${RUNNING_TEXT}` },
    feedback: {
      notes: [
        {
          id: 'moved',
          path: RUNNING,
          fromLine: 12,
          toLine: 14,
          anchor: ['        delta = x - self.mean', '        self.mean += delta / self.count', '        self.sum_sq += delta * delta'],
          kind: 'question',
          text: 'Which mean is `delta` measured from?',
          status: 'open',
          thread: 'note-moved',
          replies: 0,
          created: '',
        },
        {
          id: 'gone',
          path: RUNNING,
          fromLine: 3,
          toLine: 3,
          anchor: ['print("debug")'],
          kind: 'bug',
          text: 'About a line that is gone.',
          status: 'open',
          thread: 'note-gone',
          replies: 0,
          created: '',
        },
      ],
    },
  },
);

uiTest('a note whose code is deleted while the file is open is listed as outdated once the tab closes', async (page) => {
  await openFromTree(page, RUNNING);
  await review(page, 3);
  // Delete lines 17-18 (the note on them), save, and close the tab.
  await page.click('.cm-line:nth-child(17)');
  await page.keyboard.press('Home');
  await page.keyboard.press('Home');
  for (let i = 0; i < 2; i++) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Shift');
  }
  await page.keyboard.press('Backspace');
  assert.equal((await notesOn(page)).length, 2);
  await page.evaluate(() => window.__emit('menu', 'save'));
  await sleep(200);
  await page.evaluate(() => window.__emit('menu', 'close-tab'));
  await sleep(300);
  await page.click(`#tree .node[data-path="${RUNNING}"]`);
  await page.waitForSelector('#fb-summary .fb-group.outdated');
  assert.equal((await notesOn(page)).length, 2);
});

// ---- explain on a selection ----

uiTest('Explain answers in a note on the selection, not in the side panel, and closing removes it', async (page) => {
  await openFromTree(page, RUNNING);
  await selectLines(page, 12, 2);
  await page.waitForSelector('.selection-actions button[data-action="explain"]');
  assert.deepEqual(await asked(page), [], 'selecting asks nothing');
  await page.click('.selection-actions button[data-action="explain"]');
  await page.waitForSelector('.cm-note .fb-note.explanation .msg.tutor');
  await idle(page);
  assert.deepEqual(
    (await notesOn(page, 'explain')).map((n) => [n.fromLine, n.toLine]),
    [[12, 13]],
  );
  const sent = await lastAsked(page);
  assert.deepEqual([sent.kind, sent.about], ['review', 'explain']);
  assert.match(sent.prompt, /Selected lines \(the editor's numbers\):\n12 {2}        delta = x - self\.mean\n13 {2}/);
  assert.match(await text(page, '.cm-note .fb-thread .msg.tutor'), /Each call to push takes one new number/);
  assert.equal(await count(page, '#chat .msg'), 0, 'nothing in the side panel');

  await page.click('.cm-note .fb-action');
  assert.equal((await notesOn(page, 'explain')).length, 0);
});

uiTest('⌘E explains the selection the same way', async (page) => {
  await openFromTree(page, RUNNING);
  await page.evaluate(() => window.__emit('menu', 'ask-selection'));
  assert.match(await text(page, '#status-msg'), /Select some code/);
  await selectLines(page, 16, 4);
  await page.evaluate(() => window.__emit('menu', 'ask-selection'));
  await page.waitForSelector('.cm-note .fb-note.explanation');
  assert.deepEqual(
    (await notesOn(page, 'explain')).map((n) => [n.fromLine, n.toLine]),
    [[16, 19]],
  );
  assert.equal((await lastAsked(page)).about, 'explain');
});

uiTest('"Ask about this…" opens an empty note for the student\'s own question', async (page) => {
  await openFromTree(page, RUNNING);
  await selectLines(page, 17, 2);
  await page.waitForSelector('.selection-actions button[data-action="ask-about"]');
  await page.click('.selection-actions button[data-action="ask-about"]');
  await page.waitForFunction(() => document.activeElement?.classList.contains('fb-reply-input'));
  assert.deepEqual(await asked(page), [], 'nothing is sent until the student asks');
  assert.match(await page.$eval('.cm-note .fb-reply-input', (n) => n.placeholder), /lines 17–18/);
  await page.keyboard.type('Why 2 and not 1?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.cm-note .fb-thread .msg.tutor');
  const sent = await lastAsked(page);
  assert.deepEqual([sent.about, sent.question], ['explain', 'Why 2 and not 1?']);
  assert.match(sent.prompt, /17 {2}        if self\.count < 2:/);
});

// ---- help on a failing test ----

uiTest('a failing test offers one quiet line, and asks nothing until the student uses it', async (page) => {
  await runTests(page);
  await page.waitForSelector('#tests-detail .fb-failure .fb-expect');
  await testsDone(page);
  assert.deepEqual(await asked(page), []);
  // "Ask tutor" on the row moves to it.
  await page.click('#tests-rows .test.FAILED button');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('fb-expect')), true);

  await page.type('#tests-detail .fb-expect', 'variance 4.0, as on paper');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#tests-detail .fb-failure .msg.tutor');
  await idle(page);
  const sent = await lastAsked(page);
  assert.deepEqual([sent.kind, sent.about, sent.question], ['failure', 'failure', 'Expected: variance 4.0, as on paper']);
  assert.match(sent.thread, /^fail-/);
  assert.match(sent.prompt, /Failing test: tests\/test_running\.py::test_variance \(FAILED\)/);
  assert.match(sent.prompt, /The test \(tests\/test_running\.py, lines 11–15, test_variance\):\n11 {2}def test_variance\(\):/);
  assert.match(sent.prompt, /I expected: variance 4\.0, as on paper/);
  assert.match(await text(page, '#tests-detail .fb-failure .msg.tutor'), /compared s\.variance\(\) with 4\.0/);
  assert.equal(await count(page, '#tests-detail .fb-expect'), 0, 'the opening line goes once used');
  assert.equal(await count(page, '#chat .msg'), 0);
});

uiTest('Skip and ask sends the failure without an expectation', async (page) => {
  await runTests(page);
  await page.waitForSelector('#tests-detail .fb-skip');
  await page.click('#tests-detail .fb-skip');
  await page.waitForSelector('#tests-detail .fb-failure .msg.tutor');
  const sent = await lastAsked(page);
  assert.equal(sent.question, 'Where should I look?');
  assert.doesNotMatch(sent.prompt, /I expected/);
});

uiTest('the thread stays with the test across reruns, and a changed failure is marked and sent', async (page) => {
  await runTests(page);
  await page.waitForSelector('#tests-detail .fb-skip');
  await page.click('#tests-detail .fb-skip');
  await page.waitForSelector('#tests-detail .fb-failure .msg.tutor');
  await idle(page);
  await testsDone(page);
  const thread = (await lastAsked(page)).thread;

  await setOptions(page, { testOutcomes: { 'tests/test_running.py::test_variance': 'ERROR' } });
  await runTests(page);
  await page.waitForFunction(() => document.querySelector('#tests-detail .fb-changed') && !document.querySelector('#tests-detail .fb-changed').hidden);
  assert.equal(await count(page, '#tests-detail .fb-failure .msg.tutor'), 1, 'the conversation is still there');

  await page.type('#tests-detail .fb-reply-input', 'It errors now?');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#tests-detail .fb-failure .msg.tutor').length === 2);
  const sent = await lastAsked(page);
  assert.equal(sent.thread, thread);
  assert.match(sent.prompt, /The failure changed since my last message/);
  assert.equal(await page.$eval('#tests-detail .fb-changed', (n) => n.hidden), true);
});

uiTest(
  'starter code raising NotImplementedError offers "Where do I start?" instead',
  async (page) => {
    await runTests(page);
    await testsDone(page);
    await page.click('#tests-rows .tests-row[data-id="tests/test_model.py::test_linear"]');
    await page.waitForSelector('#tests-detail .fb-where');
    assert.equal(await count(page, '#tests-detail .fb-expect'), 0);
    await page.click('#tests-detail .fb-where');
    await page.waitForSelector('#tests-detail .fb-failure .msg.tutor');
    const sent = await lastAsked(page);
    assert.equal(sent.question, 'Where do I start?');
    assert.match(sent.prompt, /NotImplementedError/);
    assert.match(sent.prompt, /Code under test \(tests\/adapters\.py/);
  },
  {
    testsSuite: 'course',
    testsDelay: 1,
    files: {
      'tests/adapters.py':
        'import torch\n\n\ndef run_linear(d_in, d_out, weights, in_features):\n    """Apply a linear layer."""\n' +
        '\n'.repeat(25) +
        '    raise NotImplementedError\n',
    },
  },
);

uiTest('once a test the student asked about passes, one skippable checkpoint appears, once', async (page) => {
  await runTests(page);
  await page.waitForSelector('#tests-detail .fb-skip');
  await page.click('#tests-detail .fb-skip');
  await page.waitForSelector('#tests-detail .fb-failure .msg.tutor');
  await idle(page);
  await testsDone(page);

  await setOptions(page, { testOutcomes: { 'tests/test_running.py::test_variance': 'PASSED' } });
  await runTests(page);
  await page.waitForSelector('#tests-detail .fb-checkpoint');
  await testsDone(page);
  assert.match(await text(page, '#tests-detail .fb-checkpoint'), /That passes now\. In a sentence, what was wrong\?/);
  const before = (await asked(page)).length;
  await page.click('#tests-detail .fb-checkpoint .fb-skip');
  assert.equal(await page.$eval('#tests-detail .fb-checkpoint', (n) => n.hidden), true);
  assert.equal((await asked(page)).length, before, 'skipping asks nothing');

  await runTests(page);
  await testsDone(page);
  await sleep(100);
  assert.equal(await count(page, '#tests-detail .fb-checkpoint:not([hidden])'), 0, 'it never comes back');
});

uiTest('the checkpoint answer gets a short reply on the same thread, counted as a checkpoint', async (page) => {
  await runTests(page);
  await page.waitForSelector('#tests-detail .fb-expect');
  await page.type('#tests-detail .fb-expect', '4.0');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#tests-detail .fb-failure .msg.tutor');
  await idle(page);
  await testsDone(page);
  const thread = (await lastAsked(page)).thread;

  await setOptions(page, { testOutcomes: { 'tests/test_running.py::test_variance': 'PASSED' } });
  await runTests(page);
  await page.waitForSelector('#tests-detail .fb-checkpoint .fb-expect');
  await page.type('#tests-detail .fb-checkpoint .fb-expect', 'delta used the old mean');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#tests-detail .fb-checkpoint .msg.tutor');
  await idle(page);
  const sent = await lastAsked(page);
  assert.deepEqual([sent.kind, sent.about, sent.thread], ['failure', 'checkpoint', thread]);
  assert.match(await text(page, '#tests-detail .fb-checkpoint .msg.tutor'), /old mean/);

  await page.click('#show-record');
  await page.waitForSelector('#record-body .record-day');
  assert.match(await text(page, '#record-body'), /1 test failure · 1 checkpoint/);
});

uiTest('a test that passes without the student having asked shows no checkpoint', async (page) => {
  await runTests(page);
  await page.waitForSelector('#tests-detail .fb-expect');
  await testsDone(page);
  await setOptions(page, { testOutcomes: { 'tests/test_running.py::test_variance': 'PASSED' } });
  await runTests(page);
  await testsDone(page);
  await sleep(100);
  assert.equal(await count(page, '.fb-checkpoint'), 0);
  assert.deepEqual(await asked(page), []);
});

// ---- one system ----

uiTest(
  'the hidden-code check applies inside notes and their threads',
  async (page) => {
    await openFromTree(page, RUNNING);
    await review(page, 1);
    await openNote(page, 12);
    assert.equal(await count(page, '.cm-note .fb-remark .withheld'), 1, 'code in a review note is hidden');
    assert.doesNotMatch(await text(page, '.cm-note .fb-remark'), /self\.total/);

    await page.type('.cm-note .fb-reply-input', 'please include code');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.cm-note .fb-thread .msg.tutor .withheld');
    await idle(page);
    await page.click('.cm-note .fb-thread .withheld button');
    await page.waitForFunction(() => document.querySelectorAll('.cm-note .fb-thread .msg.tutor pre').length === 2);
  },
  {
    feedback: { review: '<note lines="12-14" kind="bug">\nCompare:\n\n```python\ndef push(self, x):\n    self.total += x\n    self.count += 1\n```\n</note>' },
  },
);

uiTest('every way of asking is counted in the Record view under its own name', async (page) => {
  await openFromTree(page, RUNNING);
  await review(page, 3);
  await openNote(page, 12);
  await page.type('.cm-note .fb-reply-input', 'why?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.cm-note .fb-thread .msg.tutor');
  await idle(page);
  await page.click('#show-record');
  await page.waitForSelector('#record-body .record-day');
  assert.match(await text(page, '#record-body .record-day:not(.total)'), /1 review · 1 reply to a note/);
});

uiTest('nothing is sent to the tutor without an explicit action', async (page) => {
  await openFromTree(page, RUNNING);
  await selectLines(page, 12, 2);
  await sleep(600);
  await runTests(page);
  await testsDone(page);
  await page.click('#tests-rows .test.FAILED');
  await page.click('.cm-content');
  await sleep(200);
  assert.deepEqual(await asked(page), []);
});
