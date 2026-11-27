import assert from 'node:assert/strict';
import { count, isHidden, openFromTree, sleep, text, uiTest } from './helpers.mjs';

// CodeMirror's Mod is Cmd on macOS and Ctrl elsewhere.
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const ROOT = 'file:///demo/running-stats/';

const python = { languageServers: { python: 'basedpyright' } };
// Waits short enough for a test: restarts, the idle stop and the unanswered-request limit.
const quick = { sync: 30, restarts: [40, 40, 40], idle: 150, request: 400, installCheck: 60 };

const SUMMARY = ['import nowhere', 'from stats.running import RunningStats', '', 'unused_name = 1', 's = RunningStats()', 's.push(undefined_name)', ''].join(
  '\n',
);
const withSummary = { ...python, files: { 'summary.py': SUMMARY } };

const status = (page) => text(page, '#status-language');
const statusIs = (page, wanted) => page.waitForFunction((wanted) => document.querySelector('#status-language')?.textContent === wanted, {}, wanted);
const lsp = (page, read) => page.evaluate(`(${read})(window.__lsp)`);
const serverText = (page, path) => page.evaluate((uri) => window.__lsp.docs[uri]?.text, ROOT + path);
const methods = (page) => lsp(page, (l) => l.received.map((m) => m.method).filter(Boolean));
const menu = (page, id) => page.evaluate((id) => window.__emit('menu', id), id);
const focusWindow = (page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));
const cursor = (page) => text(page, '#status-pos');
const clickMenuItem = (page, label) =>
  page.$$eval('.ctx-item', (items, label) => items.find((i) => i.querySelector('.ctx-label').textContent === label).click(), label);

async function openWithServer(page, path) {
  await page.click(`#tree .node[data-path="${path}"]`);
  await page.waitForSelector('.cm-content');
  await page.waitForFunction(() => /problem|error|warning/.test(document.querySelector('#status-language')?.textContent));
}

/** Opens a file whose server has been looked for and is not installed. */
async function openWithoutServer(page, path) {
  await page.click(`#tree .node[data-path="${path}"]`);
  await page.waitForSelector('.cm-content');
  await page.waitForFunction(() => window.__lsp.looks.length > 0);
  await sleep(50);
}

/** Puts the cursor at the end of the 1-based `line`. */
async function endOfLine(page, line) {
  await page.click(`.cm-line:nth-child(${line})`);
  await page.keyboard.press('End');
}

/** The centre of a place `word` appears in the code: the first, or the one after `skip` others. */
function pointOf(page, word, skip = 0) {
  return page.evaluate(
    (word, skip) => {
      const walker = document.createTreeWalker(document.querySelector('.cm-content'), NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent.indexOf(word);
        if (at < 0 || skip-- > 0) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + word.length);
        const box = range.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
      return null;
    },
    word,
    skip,
  );
}

// ---- no server installed ----

/** The sheet for a missing server, the way a student finds it again: File > Code Checking. */
async function openMissingSheet(page) {
  await menu(page, 'code-checking');
  await page.waitForSelector('.checking-sheet');
  await page.click('.checking-sheet .sheet-body .button');
  await page.waitForSelector('.language-sheet:not(.checking-sheet)');
}

const lookedFor = (page) => page.waitForFunction(() => window.__lsp.looks.length > 0);

uiTest(
  'without a server the status bar stays quiet; one notification per folder leads to the install command',
  async (page) => {
    await openFromTree(page, 'README.md');
    assert.equal(await isHidden(page, '#status-language'), true, 'nothing for a file no server reads');
    await openFromTree(page, 'stats/running.py');
    await page.waitForSelector('.notice');
    assert.equal(await text(page, '.notice-message'), 'No Python language server is installed, so errors are not underlined.');
    assert.equal(await isHidden(page, '#status-language'), true, 'no lasting line in the status bar');
    assert.equal(await count(page, '.cm-lintRange'), 0);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('longhand.missingServerTold'))), ['/demo/running-stats|python']);

    await page.click('.notice .button');
    await page.waitForSelector('.language-sheet');
    assert.equal(await text(page, '.language-sheet h2'), 'Python language server');
    assert.equal(await text(page, '.language-command'), 'uv tool install basedpyright');
    await page.keyboard.press('Escape');
    assert.equal(await count(page, '.language-sheet'), 0);

    // Another file of the kind does not say it again; File > Code Checking still leads there.
    await openFromTree(page, 'summary.py');
    await sleep(100);
    assert.equal(await count(page, '.notice'), 0);
    await openMissingSheet(page);
    assert.equal(await text(page, '.language-command'), 'uv tool install basedpyright');
  },
  { files: { 'summary.py': SUMMARY }, missingServerTold: false },
);

uiTest('a folder already told about the missing server is not told again', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await lookedFor(page);
  await sleep(100);
  assert.equal(await count(page, '.notice'), 0);
  assert.equal(await isHidden(page, '#status-language'), true);
});

uiTest('Put in Terminal types the command for the student to run, and does not run it', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await lookedFor(page);
  await openMissingSheet(page);
  await page.click('.language-sheet .primary');
  assert.equal(await count(page, '.language-sheet'), 0);
  await page.waitForFunction(() => Object.values(window.__term.input).flat().length);
  assert.deepEqual(await page.evaluate(() => Object.values(window.__term.input).flat()), ['uv tool install basedpyright']);
  assert.match(await text(page, '#status-msg'), /Press Return/);
});

uiTest(
  'a server installed while the app is open is picked up on Check Again, and by the checks that follow Put in Terminal',
  async (page) => {
    await openWithoutServer(page, 'summary.py');
    await openMissingSheet(page);
    await page.click('.language-sheet .sheet-foot .button:not(.primary)');
    await page.waitForFunction(() => document.querySelector('.language-check')?.textContent === 'Still not found.');
    await lsp(page, (l) => l.install('python', 'pyright'));
    await page.click('.language-sheet .sheet-foot .button:not(.primary)');
    await statusIs(page, '1 error, 1 warning');
    assert.equal(await count(page, '.language-sheet'), 0, 'the sheet closes once it is found');
    // Opening the file looks where servers were last found; Check Again asks the login shell now.
    assert.deepEqual(await lsp(page, (l) => l.looks.map((entry) => entry.look)), ['remembered', 'now', 'now']);
    assert.match(await page.$eval('#status-language', (n) => n.dataset.tip), /Checked by pyright/);
  },
  { files: { 'summary.py': SUMMARY }, languageTiming: quick },
);

uiTest(
  'after Put in Terminal the login shell is asked again for a while, so the server is found when it lands',
  async (page) => {
    await openWithoutServer(page, 'summary.py');
    await openMissingSheet(page);
    await page.click('.language-sheet .primary');
    await page.waitForFunction(() => window.__lsp.looks.some((entry) => entry.look === 'fresh'));
    await lsp(page, (l) => l.install('python', 'basedpyright'));
    await statusIs(page, '1 error, 1 warning');
  },
  { files: { 'summary.py': SUMMARY }, languageTiming: quick },
);

uiTest(
  'coming back to the window looks again where servers were last found, without reading the profile again',
  async (page) => {
    await openWithoutServer(page, 'summary.py');
    await focusWindow(page);
    await page.waitForFunction(() => window.__lsp.looks.length === 2);
    await lsp(page, (l) => l.install('python', 'basedpyright'));
    await focusWindow(page);
    await statusIs(page, '1 error, 1 warning');
    assert.deepEqual(await lsp(page, (l) => l.looks.map((entry) => entry.look)), ['remembered', 'remembered', 'remembered']);
  },
  { files: { 'summary.py': SUMMARY }, languageTiming: quick },
);

// ---- problems ----

uiTest(
  'errors and warnings are underlined, counted in the status bar and explained on hover; hints are left out',
  async (page) => {
    await openWithServer(page, 'summary.py');
    await statusIs(page, '1 error, 1 warning');
    assert.equal(await text(page, '.cm-lintRange-error'), 'undefined_name');
    assert.equal(await text(page, '.cm-lintRange-warning'), 'import nowhere');
    assert.equal(await count(page, '.cm-lintRange'), 2, 'the hint on unused_name is not drawn');
    assert.deepEqual(await page.$$eval('.cm-lineNumbers .cm-problem-line', (n) => n.map((x) => x.textContent)), ['1', '6']);

    await page.hover('.cm-lintRange-error');
    await page.waitForSelector('.cm-tooltip-lint');
    assert.equal(await text(page, '.cm-diagnostic-error'), '"undefined_name" is not defined');

    // The count is the way to the next problem, and the status bar reads it out for the keyboard.
    await page.click('#status-language');
    assert.equal(await cursor(page), 'Ln 1, Col 15');
    assert.equal(await text(page, '#status-msg'), 'Warning: Import "nowhere" could not be resolved');
    await page.click('#status-language');
    assert.equal(await text(page, '#status-msg'), 'Error: "undefined_name" is not defined');
    // The first press only collapses the selection the jump made.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.equal(await text(page, '#status-msg'), '', 'cleared once the cursor leaves the problem');
  },
  withSummary,
);

uiTest(
  'the server sees unsaved edits as they are typed, and the underlines follow',
  async (page) => {
    await openWithServer(page, 'summary.py');
    await endOfLine(page, 5);
    await page.keyboard.type('\nundefined_name');
    await statusIs(page, '2 errors, 1 warning');
    assert.match(await serverText(page, 'summary.py'), /RunningStats\(\)\nundefined_name\ns\.push/);
    assert.equal(await page.evaluate(() => window.__files['summary.py'].includes('RunningStats()\nundefined_name')), false, 'nothing was saved');
    assert.equal(await lsp(page, (l) => l.docs['file:///demo/running-stats/summary.py'].version > 1), true);

    // Fix both errors: the underlines go without saving.
    for (let i = 0; i < 'undefined_name'.length + 1; i++) await page.keyboard.press('Backspace');
    await endOfLine(page, 6);
    for (let i = 0; i < 'undefined_name)'.length; i++) await page.keyboard.press('Backspace');
    await page.keyboard.type('1.0)');
    await statusIs(page, '1 warning');
    assert.equal(await count(page, '.cm-lintRange-error'), 0);

    // Saving tells the server, which is when some run their fuller checks.
    await menu(page, 'save');
    await page.waitForFunction(() => window.__lsp.saved.length === 1);
  },
  { ...withSummary, languageTiming: quick },
);

uiTest(
  'a tab in the background stays in step: a file changed on disk reaches the server, and its problems show when the tab does',
  async (page) => {
    await openWithServer(page, 'summary.py');
    await openFromTree(page, 'stats/running.py');
    await page.waitForFunction((uri) => window.__lsp.docs[uri], {}, ROOT + 'stats/running.py');
    assert.equal(await isHidden(page, '#status-language'), true, 'nothing to say about a file without problems');
    await page.evaluate(() => {
      window.__changeOnDisk('summary.py', 'value = undefined_name\nother = undefined_name\n');
      window.__emit('files:changed', { root: '/demo/running-stats', paths: ['summary.py'] });
    });
    await page.waitForFunction((uri) => window.__lsp.docs[uri]?.text.startsWith('value ='), {}, ROOT + 'summary.py');
    await page.click('#tabs .tab');
    await statusIs(page, '2 errors');
    assert.equal(await count(page, '.cm-lintRange-error'), 2);
  },
  { ...withSummary, languageTiming: quick },
);

uiTest(
  'closing a tab closes the file for the server, and a renamed file is reopened under its new name with its unsaved text',
  async (page) => {
    await openWithServer(page, 'summary.py');
    await endOfLine(page, 5);
    await page.keyboard.type('  # mine');
    await page.click('#tree .node[data-path="summary.py"]', { button: 'right' });
    await clickMenuItem(page, 'Rename…');
    await page.$eval('#tree .new-name', (n) => (n.value = 'report.py'));
    await page.keyboard.press('Enter');
    await page.waitForFunction((uri) => window.__lsp.docs[uri], {}, ROOT + 'report.py');
    assert.match(await serverText(page, 'report.py'), /# mine/);
    assert.equal(await serverText(page, 'summary.py'), undefined, 'closed under the old name');
    await statusIs(page, '1 error, 1 warning');

    // A name no server reads: the file is closed for the server and its underlines go.
    await page.click('#tree .node[data-path="report.py"]', { button: 'right' });
    await clickMenuItem(page, 'Rename…');
    await page.$eval('#tree .new-name', (n) => (n.value = 'report.txt'));
    await page.keyboard.press('Enter');
    await page.waitForFunction((uri) => !window.__lsp.docs[uri], {}, ROOT + 'report.py');
    await page.waitForFunction(() => !document.querySelector('.cm-lintRange'));
    assert.equal(await isHidden(page, '#status-language'), true);

    await openFromTree(page, 'stats/running.py');
    await page.waitForFunction((uri) => window.__lsp.docs[uri], {}, ROOT + 'stats/running.py');
    await page.evaluate(() => window.__emit('menu', 'close-tab'));
    await page.waitForFunction((uri) => !window.__lsp.docs[uri], {}, ROOT + 'stats/running.py');
  },
  { ...withSummary, confirm: true },
);

// ---- hover, completion, signatures ----

uiTest(
  'pointing at a name shows its documentation',
  async (page) => {
    await openWithServer(page, 'summary.py');
    const point = await pointOf(page, 'RunningStats', 1);
    await page.mouse.move(point.x, point.y);
    await page.waitForSelector('.cm-lsp-hover-tooltip');
    assert.match(await text(page, '.cm-lsp-hover-tooltip'), /class RunningStats\s*Statistics over a stream of numbers/);
    assert.equal(await count(page, '.cm-lsp-hover-tooltip a[href]'), 0);
  },
  withSummary,
);

uiTest(
  'completion comes from the server while one runs, with its documentation',
  async (page) => {
    await openWithServer(page, 'summary.py');
    await endOfLine(page, 5);
    await page.keyboard.type('\ns.');
    await page.waitForSelector('.cm-tooltip-autocomplete li');
    assert.deepEqual(await page.$$eval('.cm-tooltip-autocomplete .cm-completionLabel', (n) => n.map((x) => x.textContent)), [
      'count',
      'mean',
      'push',
      'variance',
    ]);
    await page.keyboard.type('pu');
    await page.waitForFunction(() => document.querySelectorAll('.cm-tooltip-autocomplete li').length === 1);
    await page.waitForSelector('.cm-completionInfo');
    assert.match(await text(page, '.cm-completionInfo'), /Adds one number to the stream/);
    // CodeMirror ignores Enter for a moment after the list changes, so a stray one adds no completion.
    await sleep(150);
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval('.cm-line:nth-child(6)', (n) => n.textContent), 's.push');

    // A call shows the function's signature.
    await page.keyboard.type('(');
    await page.waitForSelector('.cm-lsp-signature-tooltip');
    assert.match(await text(page, '.cm-lsp-signature-tooltip'), /push\(x: float\) -> None/);
    assert.equal(await text(page, '.cm-lsp-active-parameter'), 'x: float');
  },
  withSummary,
);

uiTest(
  'without a server the editor completes from the words in the file, as before',
  async (page) => {
    await page.click('#tree .node[data-path="summary.py"]');
    await page.waitForSelector('.cm-content');
    await lookedFor(page);
    await endOfLine(page, 5);
    await page.keyboard.type('\nRunn');
    await page.waitForSelector('.cm-tooltip-autocomplete li');
    const offered = await page.$$eval('.cm-tooltip-autocomplete .cm-completionLabel', (n) => n.map((x) => x.textContent));
    assert.equal(offered[0], 'RunningStats');
    assert.equal(await page.evaluate(() => window.__lsp.started.length), 0);
  },
  { files: { 'summary.py': SUMMARY } },
);

// ---- definitions ----

uiTest(
  'Go to Definition opens the file a name is defined in, and Go Back returns',
  async (page) => {
    await openWithServer(page, 'summary.py');
    const point = await pointOf(page, 'RunningStats', 1);
    await page.mouse.click(point.x, point.y);
    assert.equal(await cursor(page), 'Ln 5, Col 11');
    await page.keyboard.press('F12');
    await page.waitForFunction(() => document.querySelector('#status-file').textContent === 'stats/running.py');
    assert.equal(await cursor(page), 'Ln 4, Col 7');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('cm-content')), true, 'the code keeps the focus');

    // Back from wherever the cursor has gone since, from the menu.
    const elsewhere = await pointOf(page, 'variance');
    await page.mouse.click(elsewhere.x, elsewhere.y);
    await menu(page, 'go-back');
    await page.waitForFunction(() => document.querySelector('#status-file').textContent === 'summary.py');
    assert.equal(await cursor(page), 'Ln 5, Col 11');

    await page.keyboard.down('Control');
    await page.keyboard.press('Minus');
    await page.keyboard.up('Control');
    assert.equal(await text(page, '#status-msg'), 'Nowhere to go back to.');
  },
  withSummary,
);

uiTest(
  '⌘-click goes to the definition; one outside the folder is named, not opened; a name with none says so',
  async (page) => {
    await openWithServer(page, 'summary.py');
    const push = await pointOf(page, 'push');
    await page.keyboard.down(MOD);
    await page.mouse.click(push.x, push.y);
    await page.keyboard.up(MOD);
    await page.waitForFunction(() => document.querySelector('#status-file').textContent === 'stats/running.py');
    assert.equal(await cursor(page), 'Ln 10, Col 9');
    // The cursor is drawn a frame after the file is shown.
    await page.waitForSelector('.cm-cursor');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.cm-cursor-primary, .cm-cursor').length), 1, 'no second cursor');

    await menu(page, 'go-back');
    await page.waitForFunction(() => document.querySelector('#status-file').textContent === 'summary.py');
    const sqrt = await pointOf(page, 'sqrt');
    await page.mouse.click(sqrt.x, sqrt.y);
    await menu(page, 'go-to-definition');
    await page.waitForFunction(() => /outside this folder, in math\.py/.test(document.querySelector('#status-msg').textContent));
    assert.equal(await text(page, '#status-file'), 'summary.py');
    assert.equal(await count(page, '#tabs .tab'), 2);

    const nothing = await pointOf(page, 'nowhere');
    await page.mouse.click(nothing.x, nothing.y);
    await menu(page, 'go-to-definition');
    await page.waitForFunction(() => document.querySelector('#status-msg').textContent === 'No definition found for this.');

    await openFromTree(page, 'README.md');
    await menu(page, 'go-to-definition');
    assert.match(await text(page, '#status-msg'), /No language server is running for this file/);
  },
  { ...python, files: { 'summary.py': SUMMARY + 'root = sqrt(2)\n' } },
);

// ---- unhappy paths ----

uiTest(
  'a server that crashes is started again and its problems come back',
  async (page) => {
    await openWithServer(page, 'summary.py');
    await statusIs(page, '1 error, 1 warning');
    await lsp(page, (l) => l.crash('python'));
    await page.waitForFunction(() => !document.querySelector('.cm-lintRange'));
    assert.equal(await isHidden(page, '#status-language'), true, 'nothing to say while it starts again');
    await page.waitForFunction(() => window.__lsp.started.length === 2);
    await statusIs(page, '1 error, 1 warning');
    assert.equal(await count(page, '.notice'), 0, 'one crash is not worth a notification');
    assert.equal(await count(page, '.cm-lintRange'), 2);
  },
  { ...withSummary, languageTiming: quick },
);

uiTest(
  'a server that keeps crashing is given up on visibly, and can be started again',
  async (page) => {
    await page.click('#tree .node[data-path="summary.py"]');
    await statusIs(page, 'Python: language server stopped');
    assert.equal(await lsp(page, (l) => l.started.length), 4, 'three restarts, then no more');
    assert.match(await text(page, '.notice'), /The Python language server keeps stopping/);
    await sleep(200);
    assert.equal(await lsp(page, (l) => l.started.length), 4);

    await page.click('.notice .button');
    await page.waitForSelector('.language-sheet');
    assert.match(await text(page, '.language-sheet .sheet-body'), /basedpyright stopped several times in a row/);
    assert.match(await text(page, '.language-command'), /RuntimeError: the mock server crashed/);
    // The editor still works, with its own completion.
    await page.click('.language-sheet .primary');
    await statusIs(page, '1 error, 1 warning');
  },
  { files: { 'summary.py': SUMMARY }, languageServers: { python: { name: 'basedpyright', crashOn: 'initialize', crashes: 4 } }, languageTiming: quick },
);

uiTest(
  'a slow server never holds up typing, and its late answers land on the right text',
  async (page) => {
    await page.click('#tree .node[data-path="summary.py"]');
    await page.waitForSelector('.cm-content');
    await statusIs(page, '1 error, 1 warning');
    // Typed above the error while the server is still answering for the older text.
    await page.click('.cm-line:nth-child(3)');
    await page.keyboard.type('x = 1');
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval('.cm-line:nth-child(3)', (n) => n.textContent), 'x = 1', 'typing is not held up');
    assert.equal(await text(page, '.cm-lintRange-error'), 'undefined_name', 'the underline moved with its code');
    await page.waitForFunction((uri) => window.__lsp.docs[uri]?.text.includes('x = 1\n'), {}, ROOT + 'summary.py');
    await sleep(400);
    assert.equal(await text(page, '.cm-lintRange-error'), 'undefined_name');
    assert.deepEqual(await page.$$eval('.cm-lineNumbers .cm-problem-line', (n) => n.map((x) => x.textContent)), ['1', '7']);
  },
  { files: { 'summary.py': SUMMARY }, languageServers: { python: { name: 'pylsp', slow: 250 } }, languageTiming: { sync: 30 } },
);

uiTest(
  'a server that never answers is reported, and is not left running',
  async (page) => {
    await page.click('#tree .node[data-path="summary.py"]');
    await statusIs(page, 'Python: language server did not start');
    assert.deepEqual(await lsp(page, (l) => l.stopped), [1], 'the silent process is not left running');
    await page.click('#status-language');
    assert.match(await text(page, '.language-sheet .sheet-body'), /pylsp started but did not answer/);
    await page.keyboard.press('Escape');
  },
  { files: { 'summary.py': SUMMARY }, languageServers: { python: { name: 'pylsp', silent: true } }, languageTiming: quick },
);

uiTest(
  'a server that will not start says why, and Start Again tries once it is fixed',
  async (page) => {
    await page.click('#tree .node[data-path="summary.py"]');
    await statusIs(page, 'Python: language server did not start');
    await page.click('#status-language');
    assert.match(await text(page, '.language-sheet .sheet-body'), /basedpyright-langserver is not executable/);
    await lsp(page, (l) => l.install('python', 'basedpyright'));
    await page.click('.language-sheet .primary');
    await statusIs(page, '1 error, 1 warning');
  },
  {
    files: { 'summary.py': SUMMARY },
    languageServers: { python: { name: 'basedpyright', failToStart: 'basedpyright-langserver is not executable.' } },
    languageTiming: quick,
  },
);

// ---- lifecycle ----

uiTest(
  'the server is told which Python the folder uses, and is offered nothing that writes code',
  async (page) => {
    await openWithServer(page, 'summary.py');
    await page.waitForFunction(() => window.__lsp.settings.python);
    assert.deepEqual(await lsp(page, (l) => l.settings.python), [{ pythonPath: '/demo/running-stats/.venv/bin/python' }]);
    const start = await lsp(page, (l) => l.received.find((m) => m.method === 'initialize').params);
    assert.equal(start.rootUri, 'file:///demo/running-stats');
    assert.equal(start.capabilities.workspace.configuration, true);
    // Nothing that writes or rewrites the student's code is offered to the server.
    const offered = start.capabilities.textDocument;
    for (const feature of ['codeAction', 'formatting', 'rename', 'references', 'declaration', 'implementation', 'typeDefinition'])
      assert.equal(offered[feature], undefined, feature);
    assert.equal(offered.completion.completionItem.snippetSupport, false);
    assert.equal(start.capabilities.window?.showMessage, undefined);
    assert.ok(offered.hover && offered.definition && offered.signatureHelp);
    assert.equal(await lsp(page, (l) => l.docs['file:///demo/running-stats/summary.py'].languageId), 'python');
    // Messages are acknowledged, which is what lets the backend hold back a server that floods.
    await page.waitForFunction(() => window.__lsp.delivered[1] > 0 && window.__lsp.acked[1] === window.__lsp.delivered[1]);
  },
  { files: { 'summary.py': SUMMARY }, languageServers: { python: { name: 'basedpyright', python: '/demo/running-stats/.venv/bin/python' } } },
);

uiTest(
  'a server stops a little after its last file closes, when the setting is turned off, and when another folder opens',
  async (page) => {
    await openWithServer(page, 'summary.py');
    await page.evaluate(() => window.__emit('menu', 'close-tab'));
    await page.waitForFunction(() => window.__lsp.stopped.length === 1);

    await page.click('#tree .node[data-path="summary.py"]');
    await statusIs(page, '1 error, 1 warning');
    await menu(page, 'settings');
    await page.click('#setting-language\\.servers');
    await page.waitForFunction(() => window.__lsp.stopped.length === 2);
    await page.keyboard.press('Escape');
    assert.equal(await isHidden(page, '#status-language'), true);
    assert.equal(await count(page, '.cm-lintRange'), 0);
    assert.equal(await page.evaluate(() => window.__prefs.settings['language.servers']), false);

    await menu(page, 'settings');
    await page.click('#setting-language\\.servers');
    await page.keyboard.press('Escape');
    await statusIs(page, '1 error, 1 warning');

    await menu(page, 'open-folder');
    await page.waitForFunction(() => window.__lsp.stopped.length === 3);
    assert.equal(await isHidden(page, '#status-language'), true);
  },
  { ...withSummary, languageTiming: quick, pick: '/Users/ada/other-course' },
);

uiTest(
  'the server only hears of an edit once the typing pauses',
  async (page) => {
    await openWithServer(page, 'summary.py');
    const before = (await methods(page)).filter((m) => m === 'textDocument/didChange').length;
    await endOfLine(page, 3);
    await page.keyboard.type('abcdefgh');
    await page.waitForFunction((uri) => window.__lsp.docs[uri].text.includes('abcdefgh'), {}, ROOT + 'summary.py');
    assert.equal((await methods(page)).filter((m) => m === 'textDocument/didChange').length - before, 1);
  },
  withSummary,
);

uiTest(
  'packages installed while the server runs are noticed, and a folder that gains its own environment gets a server inside it',
  async (page) => {
    const changed = (paths) => page.evaluate((paths) => window.__emit('files:changed', { root: '/demo/running-stats', paths }), paths);
    const configured = () => lsp(page, (l) => l.received.filter((m) => m.method === 'workspace/didChangeConfiguration').length);
    await openWithServer(page, 'summary.py');
    await changed(['stats/notes.txt']);
    await sleep(120);
    assert.equal(await configured(), 0, 'ordinary files are no reason to look again');
    await changed(['uv.lock']);
    await page.waitForFunction(() => window.__lsp.received.some((m) => m.method === 'workspace/didChangeConfiguration'));
    assert.equal(await lsp(page, (l) => l.started.length), 1);

    // `uv sync` makes .venv: the server starts again, now with the folder's interpreter.
    await page.evaluate(() => {
      window.__changeOnDisk('.venv/bin/python', '');
      window.__lsp.install('python', { name: 'basedpyright', python: '/demo/running-stats/.venv/bin/python' });
    });
    await changed(['']);
    await page.waitForFunction(() => window.__lsp.started.length === 2);
    await statusIs(page, '1 error, 1 warning');
    await page.waitForFunction(() => window.__lsp.settings.python?.[0]?.pythonPath === '/demo/running-stats/.venv/bin/python');
    assert.deepEqual(await lsp(page, (l) => l.stopped), [1]);
  },
  { ...withSummary, languageTiming: { ...quick, environment: 40 } },
);

// ---- code checking is asked for, per folder ----

const asked = { ...withSummary, codeChecking: 'ask' };

uiTest(
  'nothing runs for a folder until code checking is turned on: one quiet notification, and a sheet that says what it means',
  async (page) => {
    await page.click('#tree .node[data-path="summary.py"]');
    await page.waitForSelector('.notice');
    assert.equal(await isHidden(page, '#status-language'), true, 'no lasting line in the status bar');
    assert.match(await text(page, '.notice-message'), /Code checking is off for this folder/);
    await openFromTree(page, 'stats/running.py');
    await openFromTree(page, 'README.md');
    await page.click('#tabs .tab');
    await sleep(100);
    assert.equal(await count(page, '.notice'), 1, 'mentioned once');
    assert.deepEqual(await lsp(page, (l) => [l.started.length, l.looks.length, l.received.length]), [0, 0, 0], 'not even looked for');
    assert.equal(await count(page, '.cm-lintRange'), 0);

    await page.click('.notice .button');
    await page.waitForSelector('.checking-sheet');
    assert.equal(await count(page, '.notice'), 0);
    assert.equal(await text(page, '.checking-sheet h2'), 'Code checking');
    assert.match(
      await text(page, '.checking-sheet .sheet-body p'),
      /runs language tools on this folder, including the folder’s own Python environment\. Only turn it on for folders you trust\./,
    );
    assert.equal(await lsp(page, (l) => l.started.length), 0, 'reading about it starts nothing');
    assert.deepEqual(await page.$$eval('.checking-sheet .sheet-foot .button', (n) => n.map((x) => x.textContent)), ['Keep Off', 'Turn On']);
    await page.click('.checking-sheet .primary');
    await statusIs(page, '1 error, 1 warning');
    assert.equal(await lsp(page, (l) => l.checking), 'on', 'the backend remembers');
    assert.equal(await count(page, '.checking-sheet'), 0);
  },
  asked,
);

uiTest(
  'Escape leaves the question open, and Keep Off is remembered',
  async (page) => {
    await page.click('#tree .node[data-path="summary.py"]');
    await page.waitForSelector('.notice');
    await page.click('.notice .button');
    await page.waitForSelector('.checking-sheet');
    await page.keyboard.press('Escape');
    assert.equal(await count(page, '.checking-sheet'), 0);
    assert.equal(await lsp(page, (l) => l.checking), 'ask', 'closing the sheet decides nothing');

    await menu(page, 'code-checking');
    await page.click('.checking-sheet .sheet-foot .button:not(.primary)');
    await page.waitForFunction(() => window.__lsp.checking === 'off');
    assert.equal(await isHidden(page, '#status-language'), true);
    assert.equal(await lsp(page, (l) => l.started.length), 0);
  },
  asked,
);

uiTest(
  'a folder kept off is not asked about again, and File > Code Checking turns it on and off',
  async (page) => {
    await page.click('#tree .node[data-path="summary.py"]');
    await sleep(150);
    assert.equal(await count(page, '.notice'), 0);
    assert.equal(await isHidden(page, '#status-language'), true);
    assert.equal(await lsp(page, (l) => l.looks.length), 0);

    await menu(page, 'code-checking');
    await page.click('.checking-sheet .primary');
    await statusIs(page, '1 error, 1 warning');

    await menu(page, 'code-checking');
    await page.waitForSelector('.checking-sheet');
    assert.match(await text(page, '.checking-sheet .sheet-body'), /Code checking is on for this folder/);
    assert.deepEqual(await page.$$eval('.checking-sheet .sheet-foot .button', (n) => n.map((x) => x.textContent)), ['Turn Off', 'Keep On']);
    await page.click('.checking-sheet .sheet-foot .button:not(.primary)');
    await page.waitForFunction(() => !document.querySelector('.cm-lintRange'));
    assert.equal(await isHidden(page, '#status-language'), true);
    assert.deepEqual(await lsp(page, (l) => [l.checking, l.stopped.length]), ['off', 1]);
  },
  { ...withSummary, codeChecking: 'off' },
);

uiTest(
  'the backend has the last word: a start it refuses turns checking off in the page too',
  async (page) => {
    // Turned off behind the page's back, as by another window.
    await lsp(page, (l) => (l.checking = 'off'));
    await page.click('#tree .node[data-path="summary.py"]');
    await page.waitForFunction(() => window.__lsp.checking === 'off' && document.querySelector('.cm-content'));
    await sleep(100);
    assert.equal(await isHidden(page, '#status-language'), true);
    assert.equal(await lsp(page, (l) => l.started.length), 0);
    assert.equal(await count(page, '.cm-lintRange'), 0);
  },
  withSummary,
);

// ---- sending edits, not whole files ----

// Over the size under which the client library sends the whole text again, and with characters
// that take two code units, where a careless edit lands in the middle of one.
const LONG = ['face = "😀 and 🨀"', ...Array.from({ length: 20 }, (_, i) => `# ${'padding '.repeat(8)}${i}`), 'value = undefined_name', ''].join('\n');
const changesTo = (page, path) =>
  page.evaluate(
    (uri) =>
      window.__lsp.received.filter((m) => m.method === 'textDocument/didChange' && m.params.textDocument.uri === uri).map((m) => m.params.contentChanges),
    ROOT + path,
  );

uiTest(
  'typing in a large file sends the server only what changed, emoji included',
  async (page) => {
    await openWithServer(page, 'long.py');
    await endOfLine(page, 1);
    await page.keyboard.type('  # 😀!');
    await page.waitForFunction((uri) => window.__lsp.docs[uri].text.startsWith('face = "😀 and 🨀"  # 😀!\n# padding'), {}, ROOT + 'long.py');
    await endOfLine(page, 22);
    await page.keyboard.type('\nmore = undefined_name');
    await statusIs(page, '2 errors');
    const changes = (await changesTo(page, 'long.py')).flat();
    assert.ok(changes.length >= 2);
    assert.ok(
      changes.every((change) => change.range && change.text.length < 40),
      JSON.stringify(changes),
    );
    assert.equal(await serverText(page, 'long.py'), LONG.replace('🨀"', '🨀"  # 😀!').replace('undefined_name\n', 'undefined_name\nmore = undefined_name\n'));
  },
  { ...python, files: { 'long.py': LONG }, languageTiming: quick },
);

uiTest(
  'a large file in a background tab that changes on disk is sent as one edit that splits no character',
  async (page) => {
    await openWithServer(page, 'long.py');
    await openFromTree(page, 'stats/running.py');
    // The first emoji changes in its second half only, the last in its first half only.
    const changed = LONG.replace('😀 and 🨀', '😁 and 😀');
    await page.evaluate((changed) => {
      window.__changeOnDisk('long.py', changed);
      window.__emit('files:changed', { root: '/demo/running-stats', paths: ['long.py'] });
    }, changed);
    await page.waitForFunction((uri, changed) => window.__lsp.docs[uri].text === changed, {}, ROOT + 'long.py', changed);
    assert.deepEqual(await changesTo(page, 'long.py'), [[{ range: { start: { line: 0, character: 8 }, end: { line: 0, character: 17 } }, text: '😁 and 😀' }]]);
  },
  { ...python, files: { 'long.py': LONG }, languageTiming: quick },
);

// ---- more unhappy paths ----

uiTest(
  'a server that dies before the editor has heard it started is restarted, then given up on with what it said',
  async (page) => {
    await page.click('#tree .node[data-path="summary.py"]');
    await statusIs(page, 'Python: language server stopped');
    assert.equal(await lsp(page, (l) => l.started.length), 4, 'three restarts');
    await page.click('#status-language');
    assert.match(await text(page, '.language-command'), /bad interpreter: No such file or directory/);
    await page.keyboard.press('Escape');
  },
  {
    files: { 'summary.py': SUMMARY },
    languageServers: { python: { name: 'basedpyright', diesAtOnce: '/usr/local/bin/basedpyright-langserver: bad interpreter: No such file or directory' } },
    languageTiming: quick,
  },
);

uiTest(
  'a server that dies at once the first time recovers on the restart',
  async (page) => {
    await page.click('#tree .node[data-path="summary.py"]');
    await statusIs(page, '1 error, 1 warning');
    assert.equal(await lsp(page, (l) => l.started.length), 2);
    assert.equal(await count(page, '.notice'), 0);
  },
  { files: { 'summary.py': SUMMARY }, languageServers: { python: { name: 'basedpyright', diesAtOnce: 'killed', crashes: 1 } }, languageTiming: quick },
);

// ---- what a server may not do ----

const WITH_VARIANCE = SUMMARY + 'spread = s.variance()\n';

uiTest(
  'markup in a server’s documentation cannot run, load anything or lead anywhere',
  async (page) => {
    await openWithServer(page, 'summary.py');
    const inert = (selector) =>
      page.$eval(selector, (node) => ({
        text: node.textContent,
        risky: node.querySelectorAll('img, script, textarea, select, [href], [src], [onclick], [onerror], [style]').length,
      }));
    const point = await pointOf(page, 'variance');
    await page.mouse.move(point.x, point.y);
    await page.waitForSelector('.cm-lsp-hover-tooltip');
    const hover = await inert('.cm-lsp-hover-tooltip');
    assert.match(hover.text, /How spread out the numbers are\..*raw link.*docs/s, 'the words stay');
    assert.equal(hover.risky, 0);

    await endOfLine(page, 7);
    await page.keyboard.type('\ns.var');
    await page.waitForSelector('.cm-completionInfo');
    const info = await inert('.cm-completionInfo');
    assert.match(info.text, /How spread out the numbers are/);
    assert.equal(info.risky, 0);
    assert.equal(await page.evaluate(() => window.__ran), undefined);
  },
  { ...python, files: { 'summary.py': WITH_VARIANCE } },
);

uiTest(
  'a server cannot edit the student’s files, open documents or put up messages, and a completion adds only the name chosen',
  async (page) => {
    await openWithServer(page, 'summary.py');
    const uri = ROOT + 'summary.py';
    const edit = { changes: { [uri]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } }, newText: 'written by the server' }] } };
    await page.evaluate(
      (uri, edit) => {
        const { ask, say } = window.__lsp;
        ask('python', 'edit', 'workspace/applyEdit', { edit });
        ask('python', 'show', 'window/showDocument', { uri: 'https://example.com/', external: true });
        ask('python', 'request', 'window/showMessageRequest', { type: 1, message: 'Install the extension?', actions: [{ title: 'Yes' }] });
        say('python', 'window/showMessage', { type: 1, message: 'basedpyright wants your attention' });
        say('python', 'window/logMessage', { type: 1, message: 'indexing' });
      },
      uri,
      edit,
    );
    await page.waitForFunction(() => ['edit', 'show', 'request'].every((name) => window.__lsp.answers[name]));
    for (const name of ['edit', 'show', 'request']) {
      const response = await page.evaluate((name) => window.__lsp.answers[name], name);
      assert.equal(response.error?.code, -32601, name);
      assert.equal('result' in response, false, name);
    }
    await sleep(100);
    assert.equal(await page.$eval('.cm-line', (n) => n.textContent), 'import nowhere');
    assert.equal(await count(page, '.notice'), 0);
    assert.equal(await count(page, '.sheet'), 0);
    assert.equal(await text(page, '#status-msg'), '');
    assert.equal(await count(page, '#tabs .tab'), 1);

    // The server offers `sqrt` together with an import to add at the top of the file.
    await endOfLine(page, 5);
    await page.keyboard.type('\nsq');
    await page.waitForSelector('.cm-tooltip-autocomplete li');
    await sleep(150);
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval('.cm-line:nth-child(6)', (n) => n.textContent), 'sqrt');
    assert.equal(await page.$eval('.cm-line', (n) => n.textContent), 'import nowhere', 'no import was written for the student');
  },
  withSummary,
);

uiTest(
  'problems reported for an older text, or for a file outside the folder, are dropped',
  async (page) => {
    await openWithServer(page, 'summary.py');
    await statusIs(page, '1 error, 1 warning');
    const report = (uri, version) =>
      page.evaluate(
        (uri, version) => {
          const range = { start: { line: 2, character: 0 }, end: { line: 3, character: 6 } };
          window.__lsp.say('python', 'textDocument/publishDiagnostics', {
            uri,
            version,
            diagnostics: [{ range, severity: 1, message: 'from another time or place' }],
          });
        },
        uri,
        version,
      );
    await report(ROOT + 'summary.py', 0);
    await report('file:///usr/lib/python3.12/math.py');
    await report('file:///demo/running-stats-other/summary.py');
    await report('untitled:Untitled-1');
    await sleep(150);
    assert.equal(await status(page), '1 error, 1 warning');
    assert.equal(await count(page, '.cm-lintRange'), 2);
    // The same report for the text the server has now is shown, so it is the version that kept the others out.
    await report(ROOT + 'summary.py', 1);
    await statusIs(page, '1 error');
  },
  withSummary,
);

// ---- keys ----

uiTest(
  'Escape puts the signature away, after the completion list if that is showing too',
  async (page) => {
    await openWithServer(page, 'summary.py');
    await endOfLine(page, 5);
    await page.keyboard.type('\ns.push(');
    await page.waitForSelector('.cm-lsp-signature-tooltip');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.cm-lsp-signature-tooltip'));
    await page.keyboard.type('1.0');
    assert.equal(await page.$eval('.cm-line:nth-child(6)', (n) => n.textContent), 's.push(1.0)', 'the code keeps the focus');
    assert.equal(await count(page, '.cm-lsp-signature-tooltip'), 0, 'and it does not come back by itself');

    // It shows again for the next call.
    await page.keyboard.press('End');
    await page.keyboard.type('\ns.push(');
    await page.waitForSelector('.cm-lsp-signature-tooltip');
    await page.keyboard.type('s.');
    await page.waitForSelector('.cm-tooltip-autocomplete li');
    assert.equal(await count(page, '.cm-lsp-signature-tooltip'), 1);
    await page.keyboard.press('Escape');
    assert.equal(await count(page, '.cm-tooltip-autocomplete'), 0);
    assert.equal(await count(page, '.cm-lsp-signature-tooltip'), 1);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.cm-lsp-signature-tooltip'));
  },
  withSummary,
);

uiTest(
  'F12 reaching the page twice, as the menu’s shortcut and as a key, is one jump',
  async (page) => {
    await openWithServer(page, 'summary.py');
    const point = await pointOf(page, 'RunningStats', 1);
    await page.mouse.click(point.x, point.y);
    // Both at once, and the menu's a moment after the jump has landed.
    await page.keyboard.press('F12');
    await menu(page, 'go-to-definition');
    await page.waitForFunction(() => document.querySelector('#status-file').textContent === 'stats/running.py');
    await menu(page, 'go-to-definition');
    await sleep(100);
    assert.equal(await cursor(page), 'Ln 4, Col 7');
    assert.equal(await text(page, '#status-msg'), '', 'the second is not answered with "This is where it is defined"');

    await menu(page, 'go-back');
    await page.waitForFunction(() => document.querySelector('#status-file').textContent === 'summary.py');
    assert.equal(await cursor(page), 'Ln 5, Col 11');
    await menu(page, 'go-back');
    await page.waitForFunction(() => document.querySelector('#status-msg').textContent === 'Nowhere to go back to.');
    assert.equal(await count(page, '#tabs .tab'), 2);
  },
  withSummary,
);
