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

// ---- syntax for the languages students learn ----

uiTest(
  'C, C++, Java, JavaScript, TypeScript, Rust and Go are coloured, and Go indents with a tab',
  async (page) => {
    for (const name of ['a.c', 'b.cpp', 'C.java', 'd.js', 'e.ts', 'f.rs', 'g.go']) {
      await page.click(`#tree .node[data-path="${name}"]`);
      await page.waitForFunction((name) => document.querySelector('#status-file').textContent === name, {}, name);
      await page.waitForFunction(() => document.querySelectorAll('.cm-line span[class]').length > 1);
    }
    await endOfLine(page, 1);
    await page.keyboard.press('Enter');
    await page.keyboard.type('x');
    assert.equal(await page.$eval('.cm-line:nth-child(2)', (n) => n.textContent), '\tx');
    assert.equal(await isHidden(page, '#status-language'), false);
    assert.equal(await status(page), 'Go: no language server');
  },
  {
    files: {
      'a.c': 'int main(void) { return 0; }\n',
      'b.cpp': 'class A { public: int x = 1; };\n',
      'C.java': 'public class C { static int x = 1; }\n',
      'd.js': 'const x = function () { return 1; };\n',
      'e.ts': 'const x: number = 1; interface A { y: string }\n',
      'f.rs': 'fn main() { let x = 1; }\n',
      'g.go': 'func main() {\n}\n',
    },
  },
);

// ---- no server installed ----

uiTest('without a server the status bar says so quietly, and the sheet behind it has the install command', async (page) => {
  await openFromTree(page, 'README.md');
  assert.equal(await isHidden(page, '#status-language'), true, 'nothing for a file no server reads');
  await openFromTree(page, 'stats/running.py');
  await statusIs(page, 'Python: no language server');
  assert.equal(await count(page, '.notice'), 0, 'no notification');
  assert.equal(await count(page, '.cm-lintRange'), 0);

  await page.focus('#status-language');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.language-sheet');
  assert.equal(await text(page, '.language-sheet h2'), 'Python language server');
  assert.equal(await text(page, '.language-command'), 'uv tool install basedpyright');
  await page.keyboard.press('Escape');
  assert.equal(await count(page, '.language-sheet'), 0);
});

uiTest('Put in Terminal types the command for the student to run, and does not run it', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await statusIs(page, 'Python: no language server');
  await page.click('#status-language');
  await page.click('.language-sheet .primary');
  assert.equal(await count(page, '.language-sheet'), 0);
  await page.waitForFunction(() => Object.values(window.__term.input).flat().length);
  assert.deepEqual(await page.evaluate(() => Object.values(window.__term.input).flat()), ['uv tool install basedpyright']);
  assert.match(await text(page, '#status-msg'), /Press Return/);
});

uiTest(
  'a server installed while the app is open is picked up: after the install command, on Check Again, and on returning to the window',
  async (page) => {
    await openFromTree(page, 'stats/running.py');
    await statusIs(page, 'Python: no language server');
    await page.click('#status-language');
    await page.click('.language-sheet .sheet-foot .button:not(.primary)');
    await page.waitForFunction(() => document.querySelector('.language-check')?.textContent === 'Still not found.');
    await lsp(page, (l) => l.install('python', 'pyright'));
    await page.click('.language-sheet .sheet-foot .button:not(.primary)');
    await statusIs(page, 'No problems');
    assert.equal(await count(page, '.language-sheet'), 0, 'the sheet closes once it is found');
    assert.match(await page.$eval('#status-language', (n) => n.dataset.tip), /Checked by pyright/);

    // C: found when the window gets the focus back.
    await page.click('#tree .node[data-path="a.c"]');
    await statusIs(page, 'C: no language server');
    await lsp(page, (l) => l.install('clang', 'clangd'));
    await focusWindow(page);
    await statusIs(page, 'No problems');

    // Go: found by the checks that follow Put in Terminal.
    await page.click('#tree .node[data-path="g.go"]');
    await statusIs(page, 'Go: no language server');
    await page.click('#status-language');
    await page.click('.language-sheet .primary');
    await lsp(page, (l) => l.install('go', 'gopls'));
    await statusIs(page, 'No problems');
  },
  { files: { 'a.c': 'int main(void) { return 0; }\n', 'g.go': 'package main\n' }, languageTiming: quick },
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
    await statusIs(page, 'No problems');
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
    await statusIs(page, 'Python: no language server');
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
    assert.equal(await status(page), 'Python: starting…');
    await statusIs(page, '1 error, 1 warning');
    assert.equal(await lsp(page, (l) => l.started.length), 2);
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
  'a server that never answers, or will not start, is reported with a way to try again',
  async (page) => {
    await page.click('#tree .node[data-path="summary.py"]');
    await statusIs(page, 'Python: language server did not start');
    assert.deepEqual(await lsp(page, (l) => l.stopped), [1], 'the silent process is not left running');
    await page.click('#status-language');
    assert.match(await text(page, '.language-sheet .sheet-body'), /pylsp started but did not answer/);
    await page.keyboard.press('Escape');

    await page.click('#tree .node[data-path="main.rs"]');
    await statusIs(page, 'Rust: language server did not start');
    await page.click('#status-language');
    assert.match(await text(page, '.language-sheet .sheet-body'), /rust-analyzer is not executable/);
    await lsp(page, (l) => l.install('rust', 'rust-analyzer'));
    await page.click('.language-sheet .primary');
    await statusIs(page, 'No problems');
  },
  {
    files: { 'summary.py': SUMMARY, 'main.rs': 'fn main() {}\n' },
    languageServers: { python: { name: 'pylsp', silent: true }, rust: { name: 'rust-analyzer', failToStart: 'rust-analyzer is not executable.' } },
    languageTiming: quick,
  },
);

// ---- lifecycle ----

uiTest(
  'the server is told which Python the folder uses, and each language gets its own server',
  async (page) => {
    await openWithServer(page, 'summary.py');
    await page.waitForFunction(() => window.__lsp.settings.python);
    assert.deepEqual(await lsp(page, (l) => l.settings.python), [{ pythonPath: '/demo/running-stats/.venv/bin/python' }]);
    const start = await lsp(page, (l) => l.received.find((m) => m.method === 'initialize').params);
    assert.equal(start.rootUri, 'file:///demo/running-stats');
    assert.equal(start.capabilities.textDocument.codeAction, undefined, 'no quick fixes are asked for');
    assert.equal(start.capabilities.workspace.configuration, true);

    await page.click('#tree .node[data-path="a.c"]');
    await statusIs(page, 'No problems');
    await page.click('#tree .node[data-path="b.cpp"]');
    await page.waitForFunction((uri) => window.__lsp.docs[uri], {}, ROOT + 'b.cpp');
    assert.deepEqual(await lsp(page, (l) => l.started.map((s) => s.kind)), ['python', 'clang'], 'C and C++ share clangd');
    assert.deepEqual(await lsp(page, (l) => [l.docs['file:///demo/running-stats/a.c'].languageId, l.docs['file:///demo/running-stats/b.cpp'].languageId]), [
      'c',
      'cpp',
    ]);
    // Messages are acknowledged, which is what lets the backend hold back a server that floods.
    await page.waitForFunction(() => window.__lsp.acked[1] > 0 && window.__lsp.acked[2] > 0);
  },
  {
    files: { 'summary.py': SUMMARY, 'a.c': 'int main(void) { return 0; }\n', 'b.cpp': 'int f() { return 1; }\n' },
    languageServers: { python: { name: 'basedpyright', python: '/demo/running-stats/.venv/bin/python' }, clang: 'clangd' },
  },
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
