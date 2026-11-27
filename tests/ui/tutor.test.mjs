import assert from 'node:assert/strict';
import { askTutor, count, isHidden, openFromTree, sleep, text, uiTest } from './helpers.mjs';

uiTest("asking about a failure attaches it and sends the student's own account", async (page) => {
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

uiTest('the open file and selection travel with a question', async (page) => {
  await openFromTree(page, 'stats/running.py');
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

uiTest('code beyond the strict limit is hidden until revealed, and the reveal is counted', async (page) => {
  await askTutor(page, 'please include code');
  assert.equal(await count(page, '.msg.tutor .withheld'), 1);
  assert.equal(await count(page, '.msg.tutor pre'), 1, 'the shell command stays visible');
  assert.doesNotMatch(await text(page, '.msg.tutor'), /def push/);
  await page.click('.msg.tutor .withheld button');
  await page.waitForFunction(() => document.querySelectorAll('.msg.tutor pre').length === 2);
  assert.match(await text(page, '#reliance'), /1 code reveal/);
});

uiTest('the guided policy shows short examples', async (page) => {
  await page.select('#policy', 'guided');
  await sleep(100);
  await askTutor(page, 'please include code');
  assert.equal(await count(page, '.msg.tutor .withheld'), 0);
  assert.equal(await count(page, '.msg.tutor pre'), 2);
});

uiTest('tutor answers cannot inject markup or navigate the window', async (page) => {
  await askTutor(page, 'please be hostile');
  assert.equal(await count(page, '.msg.tutor script, .msg.tutor img, .msg.tutor iframe, .msg.tutor [onclick], .msg.tutor [onerror]'), 0);
  assert.equal(await count(page, '.msg.tutor a[href]'), 0);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
});

uiTest(
  'without Claude Code the tutor shows setup steps and the editor still works',
  async (page) => {
    assert.equal(await isHidden(page, '#setup'), false);
    assert.equal(await isHidden(page, '#ask'), true);
    assert.equal(await count(page, '#setup-steps li'), 3);
    assert.match(await text(page, '#auth'), /not found/);
    await openFromTree(page, 'stats/running.py');
    assert.equal(await count(page, '#tabs .tab'), 1);
    await page.evaluate(() => (window.__MOCK__.auth = { installed: true, loggedIn: true, plan: 'pro' }));
    await page.click('#setup-check');
    await page.waitForFunction(() => document.querySelector('#setup').hidden);
    assert.equal(await text(page, '#auth'), 'Claude Pro');
    assert.equal(await isHidden(page, '#ask'), false);
  },
  { auth: { installed: false, loggedIn: false } },
);
