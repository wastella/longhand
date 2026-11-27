// Interface tests: drive the real interface in headless Chrome against the mock backend.
// Usage: npm run test:ui
import assert from 'node:assert/strict';
import { launch, openApp, sleep } from './browser.mjs';

const browser = await launch();
const tests = [];
const test = (name, fn, options) => tests.push({ name, fn, options });
const text = (page, sel) => page.$eval(sel, (n) => n.textContent);
const count = (page, sel) => page.$$eval(sel, (n) => n.length);
const hidden = (page, sel) => page.$eval(sel, (n) => n.hidden);

async function openRunning(page) {
  await page.click('#tree .node[data-path="stats"]');
  await page.click('#tree .node[data-path="stats/running.py"]');
  await page.waitForSelector('.cm-content');
}

async function askTutor(page, question) {
  await page.type('#input', question);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#send').hidden && document.querySelector('.msg.tutor'));
}

test('opens a folder and lists its files, folders first', async (page) => {
  assert.equal(await text(page, '#ws-name'), 'running-stats');
  const names = await page.$$eval('#tree .node .label', (n) => n.map((x) => x.textContent));
  assert.deepEqual(names, ['stats', 'tests', 'pyproject.toml', 'README.md']);
  assert.match(await text(page, '#course-note'), /AGENTS\.md/);
});

test('opens a file in a tab and tracks unsaved edits', async (page) => {
  await openRunning(page);
  assert.equal(await count(page, '#tabs .tab'), 1);
  assert.equal(await text(page, '#status-file'), 'stats/running.py');
  await page.click('.cm-content');
  await page.keyboard.type('# note\n');
  assert.equal(await count(page, '#tabs .tab.dirty'), 1);
  await page.evaluate(() => window.__emit('menu', 'save'));
  await page.waitForFunction(() => !document.querySelector('#tabs .tab.dirty'));
  assert.match(await page.evaluate(() => window.__files['stats/running.py']), /# note\n/);
});

test('shows test results with failures first and the traceback', async (page) => {
  await page.evaluate(() => document.querySelector('#run-all-tests').click());
  await page.waitForSelector('#tests-list .test.FAILED');
  const rows = await page.$$eval('#tests-list .test .name', (n) => n.map((x) => x.textContent));
  assert.deepEqual(rows, ['test_variance', 'test_mean']);
  assert.equal(await text(page, '#tests-badge'), '1 failing');
  assert.match(await text(page, '#tests-detail'), /assert 6\.0 == 4\.0/);
  assert.equal(await count(page, '#tests-list .test button'), 1);
});

test("asking about a failure attaches it and sends the student's own account", async (page) => {
  await page.evaluate(() => document.querySelector('#run-all-tests').click());
  await page.waitForSelector('#tests-list .test.FAILED button');
  await page.click('#tests-list .test.FAILED button');
  assert.match(await page.$eval('#input', (n) => n.placeholder), /What did you expect/);
  await askTutor(page, 'I expected 4.0');
  const sent = await page.evaluate(() => window.__asked.at(-1));
  assert.equal(sent.kind, 'failure');
  assert.match(sent.prompt, /<context>[\s\S]*Failing test: tests\/test_running\.py::test_variance[\s\S]*<\/context>\s+I expected 4\.0$/);
  assert.match(await text(page, '.msg.tutor'), /look at what push accumulates/);
  assert.match(await text(page, '.msg.user .ctx'), /test_variance/);
});

test('the open file and selection travel with a question', async (page) => {
  await openRunning(page);
  await page.evaluate(() => window.__emit('menu', 'ask-selection'));
  assert.match(await text(page, '#status-msg'), /Select some code/);
  await page.click('.cm-content');
  // Select all: Cmd on macOS, Ctrl elsewhere.
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.down(mod);
  await page.keyboard.press('a');
  await page.keyboard.up(mod);
  await page.evaluate(() => window.__emit('menu', 'ask-selection'));
  await page.waitForFunction(() => window.__asked.length === 1);
  const sent = await page.evaluate(() => window.__asked[0]);
  assert.match(sent.prompt, /Open file: stats\/running\.py/);
  assert.match(sent.prompt, /Selected lines 1-\d+:/);
});

test('code beyond the strict limit is hidden until revealed, and the reveal is counted', async (page) => {
  await askTutor(page, 'please include code');
  assert.equal(await count(page, '.msg.tutor .withheld'), 1);
  assert.equal(await count(page, '.msg.tutor pre'), 1, 'the shell command stays visible');
  assert.doesNotMatch(await text(page, '.msg.tutor'), /def push/);
  await page.click('.msg.tutor .withheld button');
  await page.waitForFunction(() => document.querySelectorAll('.msg.tutor pre').length === 2);
  assert.match(await text(page, '#reliance'), /1 code reveal/);
});

test('the guided policy shows short examples', async (page) => {
  await page.select('#policy', 'guided');
  await sleep(100);
  await askTutor(page, 'please include code');
  assert.equal(await count(page, '.msg.tutor .withheld'), 0);
  assert.equal(await count(page, '.msg.tutor pre'), 2);
});

test('tutor answers cannot inject markup or navigate the window', async (page) => {
  await askTutor(page, 'please be hostile');
  assert.equal(await count(page, '.msg.tutor script, .msg.tutor img, .msg.tutor iframe, .msg.tutor [onclick], .msg.tutor [onerror]'), 0);
  assert.equal(await count(page, '.msg.tutor a[href]'), 0);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
});

test('finds text across files and jumps to the line', async (page) => {
  await page.click('#toggle-search');
  await page.type('#search-input', 'sum_sq');
  await page.waitForSelector('#search-results .hit');
  assert.equal(await count(page, '#search-results .hit'), 3);
  await page.click('#search-results .hit');
  await page.waitForSelector('.cm-content');
  assert.equal(await text(page, '#status-pos'), 'Ln 8, Col 1');
});

test('the file tree menu creates, renames and trashes', async (page) => {
  await page.click('#tree .node[data-path="README.md"]', { button: 'right' });
  const items = await page.$$eval('.ctx-item', (n) => n.map((x) => x.textContent));
  assert.deepEqual(items, ['New File…', 'New Folder…', 'Rename…', 'Move to Trash']);
  await page.click('.ctx-item:nth-of-type(1)');
  await page.type('#tree .new-name', 'notes.md');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#tree .node[data-path="notes.md"]');
  assert.equal(await text(page, '#status-file'), 'notes.md');

  await page.click('#tree .node[data-path="notes.md"]', { button: 'right' });
  await page.click('.ctx-item:nth-of-type(3)');
  await page.$eval('#tree .new-name', (n) => (n.value = 'journal.md'));
  await page.keyboard.press('Enter');
  await page.waitForSelector('#tree .node[data-path="journal.md"]');
  assert.equal(await text(page, '#tabs .tab.active span'), 'journal.md');

  await page.click('#tree .node[data-path="journal.md"]', { button: 'right' });
  await page.click('.ctx-item:nth-of-type(4)');
  await page.waitForFunction(() => !document.querySelector('#tree .node[data-path="journal.md"]'));
  assert.equal(await count(page, '#tabs .tab'), 0);
});

test(
  'without Claude Code the tutor shows setup steps and the editor still works',
  async (page) => {
    assert.equal(await hidden(page, '#setup'), false);
    assert.equal(await hidden(page, '#ask'), true);
    assert.equal(await count(page, '#setup-steps li'), 3);
    assert.match(await text(page, '#auth'), /not found/);
    await openRunning(page);
    assert.equal(await count(page, '#tabs .tab'), 1);
    await page.evaluate(() => (window.__MOCK__.auth = { installed: true, loggedIn: true, plan: 'pro' }));
    await page.click('#setup-check');
    await page.waitForFunction(() => document.querySelector('#setup').hidden);
    assert.equal(await text(page, '#auth'), 'Claude Pro');
    assert.equal(await hidden(page, '#ask'), false);
  },
  { auth: { installed: false, loggedIn: false } },
);

let failed = 0;
for (const t of tests) {
  const { page, errors } = await openApp(browser, t.options);
  try {
    await t.fn(page);
    assert.deepEqual(errors, [], 'no uncaught errors in the page');
    console.log(`ok    ${t.name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${t.name}\n      ${String(e.message).split('\n').join('\n      ')}`);
  }
  await page.close();
}
await browser.close();
console.log(`\n${tests.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
