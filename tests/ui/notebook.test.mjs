import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseJson, dumpJson, splitLines } from '../../src/renderer/notebook/json.js';
import { parseNotebook, serializeNotebook } from '../../src/renderer/notebook/format.js';
import { overwrite } from '../../src/renderer/notebook/outputs.js';
import { count, sleep, text, uiTest } from './helpers.mjs';

const fixture = (name) => readFileSync(new URL(`../fixtures/notebooks/${name}`, import.meta.url), 'utf8');
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/** A notebook file with these cells ([type, source, extra fields]), as nbformat writes one. */
function notebook(cells, minor = 5) {
  return serializeNotebook({
    cells: cells.map(([type, source, extra = {}], i) => ({
      key: `k${i}`,
      type,
      source,
      count: extra.count ?? null,
      outputs: extra.outputs ?? [],
      rest: { metadata: {}, ...(minor >= 5 ? { id: `cell${i}` } : {}) },
    })),
    rest: { metadata: {}, nbformat: 4, nbformat_minor: minor },
  });
}

const BASIC = notebook([
  ['markdown', '# Tokenizer\n\nWrite the **merge** step.'],
  ['code', "print('hello')"],
  ['code', 'x = 40\nx + 2'],
]);

async function openNotebook(page, path = 'hw.ipynb') {
  await page.click(`#tree .node[data-path="${path}"]`);
  await page.waitForSelector('.notebook:not([hidden]) .nb-cell');
}

const cellTexts = (page) => page.$$eval('.notebook:not([hidden]) .nb-cell', (cells) => cells.map((c) => c.querySelector('.cm-content').textContent));
const outputsOf = (page, i) => page.$$eval('.notebook:not([hidden]) .nb-cell', (cells, i) => cells[i].querySelector('.nb-outputs').textContent, i);
const promptOf = (page, i) => page.$$eval('.notebook:not([hidden]) .nb-cell', (cells, i) => cells[i].querySelector('.nb-prompt').textContent, i);
const metaOf = (page, i) => page.$$eval('.notebook:not([hidden]) .nb-cell', (cells, i) => cells[i].querySelector('.nb-meta').textContent, i);
const saved = (page, path = 'hw.ipynb') => page.evaluate((path) => window.__files[path], path);

/** Clicks into cell `i`'s editor, at the end of its text. */
async function editCell(page, i) {
  await page.$$eval('.notebook:not([hidden]) .nb-cell', (cells, i) => cells[i].querySelector('.cm-content').focus(), i);
  await page.keyboard.down(MOD);
  await page.keyboard.press('End');
  await page.keyboard.up(MOD);
}

/** Clicks a button on the notebook's bar (Run All, Interrupt, Restart) or cell `cell`'s tools, by its words or tip. */
async function press(page, label, cell = null) {
  await page.$$eval(
    '.notebook:not([hidden]) .nb-toolbar button, .notebook:not([hidden]) .nb-cell .nb-tools button',
    (buttons, [label, cell]) => {
      const cells = [...document.querySelectorAll('.notebook:not([hidden]) .nb-cell')];
      const button = buttons.find(
        (b) =>
          (b.textContent.trim() === label || b.dataset.tip === label) && (cell === null ? b.closest('.nb-toolbar') : b.closest('.nb-cell') === cells[cell]),
      );
      if (!button) throw new Error(`No button ${label}`);
      button.click();
    },
    [label, cell],
  );
}

const focusedCell = (page) => page.evaluate(() => [...document.querySelectorAll('.nb-cell')].findIndex((c) => c.contains(document.activeElement)));

const waitForText = (page, i, wanted) =>
  page.waitForFunction(
    (i, wanted) => document.querySelectorAll('.notebook:not([hidden]) .nb-cell')[i]?.querySelector('.nb-outputs').textContent.includes(wanted),
    {},
    i,
    wanted,
  );

// ---- the file format, without a browser ----

test('notebooks written by nbformat come back byte for byte', () => {
  for (const name of ['assignment.ipynb', 'minor4.ipynb']) {
    const original = fixture(name);
    assert.equal(serializeNotebook(parseNotebook(original)), original, name);
  }
  // Windows line breaks are kept as they were.
  const crlf = fixture('minor4.ipynb').replaceAll('\n', '\r\n');
  assert.equal(serializeNotebook(parseNotebook(crlf), '\r\n'), crlf);
});

test('JSON is written as Python writes it', () => {
  const value = parseJson('{"b": [1.0, 1e-05, 2.5e+20, -0], "a": "tab\\t \\u0001 é  ", "c": {}, "d": []}');
  assert.equal(dumpJson(value), '{\n "a": "tab\\t \\u0001 é  ",\n "b": [\n  1.0,\n  1e-05,\n  2.5e+20,\n  -0\n ],\n "c": {},\n "d": []\n}');
  assert.equal(dumpJson({ n: 0.1, m: 1e-7, big: 1e16, whole: 3 }), '{\n "big": 1e+16,\n "m": 1e-07,\n "n": 0.1,\n "whole": 3\n}');
  assert.deepEqual(splitLines('a\nb\r\nc\rd\x0ce'), ['a\n', 'b\r\n', 'c\r', 'd\x0c', 'e']);
  assert.throws(() => parseJson('{"a": 1,}'), SyntaxError);
});

test('Jupyter metadata, ids, attachments and unknown outputs are kept', () => {
  const original = fixture('assignment.ipynb');
  const nb = parseNotebook(original);
  nb.cells[1].source = 'print("changed")';
  const changed = serializeNotebook(nb);
  const before = original.split('\n');
  const after = changed.split('\n');
  let start = 0;
  while (before[start] === after[start]) start++;
  let end = 0;
  while (before.at(-1 - end) === after.at(-1 - end)) end++;
  const line = (text, last = false) => `    ${JSON.stringify(text)}${last ? '' : ','}`;
  assert.deepEqual(before.slice(start, before.length - end), [
    line('import math\n'),
    line("print('hello')\n"),
    line("print('tab\\there', 'ünïcode', '\\x1b[31mred\\x1b[0m')\n"),
    line('math.pi', true),
  ]);
  assert.deepEqual(after.slice(start, after.length - end), [line('print("changed")', true)]);
  assert.match(changed, /"tolerance": 1e-05/);
  assert.match(changed, /"attachments"/);
});

test('notebooks in other formats or not notebooks at all are refused with a reason', () => {
  assert.throws(
    () => parseNotebook('{"nbformat": 3, "worksheets": []}'),
    (e) => e.kind === 'old',
  );
  assert.throws(
    () => parseNotebook('{"cells": [}'),
    (e) => e.kind === 'invalid',
  );
  assert.throws(
    () => parseNotebook('{"nbformat": 4, "cells": [{"cell_type": "slide"}]}'),
    (e) => e.kind === 'invalid',
  );
});

test('carriage returns redraw the line, as a terminal does', () => {
  assert.equal(overwrite('10%\r20%\r30%'), '30%');
  assert.equal(overwrite('a\nprogress 1\rprogress 2\n'), 'a\nprogress 2\n');
  assert.equal(overwrite('long line\rshort'), 'shortline');
  assert.equal(overwrite('waiting\r'), 'waiting\r');
  assert.equal(overwrite('ab\bc'), 'ac');
});

// ---- the notebook tab ----

uiTest(
  'a notebook opens as cells and starts no Python until a cell runs',
  async (page) => {
    await openNotebook(page);
    assert.deepEqual(await cellTexts(page), ['# Tokenizer\n\nWrite the **merge** step.'.replaceAll('\n', ''), "print('hello')", 'x = 40x + 2']);
    assert.equal(await text(page, '.nb-rendered h1'), 'Tokenizer');
    assert.equal(await text(page, '.nb-kernel-status'), 'Python');
    await sleep(100);
    assert.deepEqual(await page.evaluate(() => window.__kernel.started), [], 'opening runs nothing');
    assert.equal(await count(page, '#tabs .tab.dirty'), 0);
    assert.equal(await text(page, '#status-saved'), 'Saved');
  },
  { files: { 'hw.ipynb': BASIC } },
);

uiTest(
  'Shift+Enter runs a cell and moves on; outputs and counts appear',
  async (page) => {
    await openNotebook(page);
    await editCell(page, 1);
    await page.keyboard.down('Shift');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Shift');
    await waitForText(page, 1, 'hello');
    assert.equal(await promptOf(page, 1), '[1]');
    assert.match(await metaOf(page, 1), /^Ran in \d+\.\d s$/);
    assert.equal(await focusedCell(page), 2, 'the next cell has the focus');
    assert.match(await text(page, '.nb-kernel-status'), /Python 3\.12\.4 · Idle/);
    // Cmd+Enter runs in place.
    await editCell(page, 2);
    await page.keyboard.down(MOD);
    await page.keyboard.press('Enter');
    await page.keyboard.up(MOD);
    await waitForText(page, 2, 'x + 2');
    assert.equal(await promptOf(page, 2), '[2]');
    assert.equal(await page.evaluate(() => window.__kernel.started.length), 1, 'one kernel for the notebook');
    // Outputs are unsaved changes, like edits.
    assert.equal(await count(page, '#tabs .tab.dirty'), 1);
    assert.equal(await text(page, '#status-saved'), 'Unsaved');
  },
  { files: { 'hw.ipynb': BASIC } },
);

uiTest(
  'editing and saving writes only what changed, in Jupyter’s format',
  async (page) => {
    await openNotebook(page);
    await editCell(page, 1);
    await page.keyboard.type(" + '!'");
    assert.equal(await count(page, '#tabs .tab.dirty'), 1);
    await page.evaluate(() => window.__emit('menu', 'save'));
    await page.waitForFunction(() => !document.querySelector('#tabs .tab.dirty'));
    const expected = BASIC.replace(`"print('hello')"`, `"print('hello') + '!'"`);
    assert.equal(await saved(page), expected);
    // Undoing back to the saved text is clean again, as in any file.
    await page.keyboard.down(MOD);
    await page.keyboard.press('KeyZ');
    await page.keyboard.up(MOD);
    assert.equal(await count(page, '#tabs .tab.dirty'), 1);
  },
  { files: { 'hw.ipynb': BASIC } },
);

uiTest(
  'cells are added below and deleted, and a deletion is undone with its text',
  async (page) => {
    await openNotebook(page);
    await press(page, 'Add a code cell below', 1);
    assert.equal(await focusedCell(page), 2, 'the new cell has the focus');
    await page.keyboard.type('y = 1');
    await press(page, 'Add a Markdown cell below', 2);
    assert.deepEqual(await page.$$eval('.nb-cell', (cells) => cells.map((c) => c.dataset.type)), ['markdown', 'code', 'code', 'markdown', 'code']);
    await press(page, 'Delete cell', 3);
    await press(page, 'Delete cell', 2);
    assert.deepEqual(await cellTexts(page), ['# TokenizerWrite the **merge** step.', "print('hello')", 'x = 40x + 2']);
    // Undo on the notice brings the cell back with its text.
    await page.click('.notice button.button.small');
    assert.deepEqual((await cellTexts(page)).slice(1, 3), ["print('hello')", 'y = 1']);
    // Cmd+Z outside a cell's editor undoes the other deletion, then the additions, one by one.
    const undoCells = async () => {
      await page.focus('.nb-scroll');
      await page.keyboard.down(MOD);
      await page.keyboard.press('KeyZ');
      await page.keyboard.up(MOD);
    };
    await undoCells();
    assert.equal(await count(page, '.notebook:not([hidden]) .nb-cell'), 5);
    await undoCells();
    await undoCells();
    assert.equal(await count(page, '.notebook:not([hidden]) .nb-cell'), 3);
    // Deleting the only cell leaves an empty one to type in.
    for (let i = 0; i < 3; i++) await press(page, 'Delete cell', 0);
    assert.deepEqual(await cellTexts(page), ['']);
  },
  { files: { 'hw.ipynb': BASIC } },
);

uiTest(
  'a Markdown cell shows its source on Enter and renders again when run',
  async (page) => {
    await openNotebook(page);
    await page.focus('.nb-rendered');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.querySelector('.nb-cell .nb-input').hidden), false);
    await page.keyboard.type(' More.');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(() => document.querySelector('.nb-cell .nb-input').hidden), true);
    assert.match(await text(page, '.nb-rendered'), /More\./);
    assert.deepEqual(await page.evaluate(() => window.__kernel.sent), [], 'Markdown is not sent to Python');
  },
  { files: { 'hw.ipynb': BASIC } },
);

uiTest(
  'Run All stops at an error and says which cells were not run',
  async (page) => {
    await openNotebook(page);
    await press(page, 'Run All');
    await waitForText(page, 1, 'ZeroDivisionError');
    await page.waitForFunction(() => document.querySelectorAll('.nb-cell')[2].querySelector('.nb-meta').textContent.includes('Not run'));
    assert.equal(await metaOf(page, 2), 'Not run, because a cell before it stopped with an error.');
    assert.match(await metaOf(page, 1), /^Failed in/);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.nb-error span')).color !== ''), true, 'the traceback keeps its colours');
  },
  {
    files: {
      'hw.ipynb': notebook([
        ['markdown', 'Intro'],
        ['code', '1/0'],
        ['code', "print('after')"],
      ]),
    },
  },
);

uiTest(
  'Stop interrupts an endless loop',
  async (page) => {
    await openNotebook(page);
    await editCell(page, 0);
    await page.keyboard.down(MOD);
    await page.keyboard.press('Enter');
    await page.keyboard.up(MOD);
    await page.waitForSelector('.nb-cell.running');
    assert.equal(await promptOf(page, 0), '[*]');
    assert.match(await text(page, '.nb-kernel-status'), /Running/);
    await press(page, 'Interrupt');
    await waitForText(page, 0, 'KeyboardInterrupt');
    assert.equal(await count(page, '.nb-cell.running'), 0);
  },
  { files: { 'hw.ipynb': notebook([['code', 'while True:\n    pass']]) } },
);

uiTest(
  'Restart asks first, then starts a fresh kernel',
  async (page) => {
    await openNotebook(page);
    await press(page, 'Restart');
    assert.match(await text(page, '#status-msg'), /not running yet/);
    await press(page, 'Run All');
    await waitForText(page, 1, 'hello');
    await page.evaluate(() => (window.__MOCK__.confirm = false));
    await press(page, 'Restart');
    await sleep(50);
    assert.match(await page.evaluate(() => window.__confirmed), /variables will be lost/);
    assert.deepEqual(await page.evaluate(() => window.__kernel.stopped), []);
    await page.evaluate(() => (window.__MOCK__.confirm = true));
    await press(page, 'Restart');
    await page.waitForFunction(() => window.__kernel.started.length === 2 && window.__kernel.stopped.length === 1);
    await page.waitForFunction(() => document.querySelector('.nb-kernel-status').dataset.state === 'idle');
    assert.equal(await outputsOf(page, 1), 'hello\n', 'outputs stay until the cells run again');
  },
  { files: { 'hw.ipynb': BASIC } },
);

uiTest(
  'a cell that asks for input fails with one readable line',
  async (page) => {
    await openNotebook(page);
    await press(page, 'Run All');
    await waitForText(page, 0, 'cannot give');
    assert.equal(await outputsOf(page, 0), 'This cell asked for input, which notebooks in Longhand cannot give. Set the value in the code instead.');
    assert.equal(await count(page, '.nb-stdin, .notebook input'), 0);
  },
  { files: { 'hw.ipynb': notebook([['code', "name = input('Name? ')"]]) } },
);

uiTest(
  'a kernel that dies says so, and the next run starts a new one',
  async (page) => {
    await openNotebook(page);
    await press(page, 'Run All');
    await page.waitForSelector('.nb-notice:not([hidden])');
    assert.match(await text(page, '.nb-notice'), /Python exited.*variables are gone/s);
    assert.equal(await text(page, '.nb-kernel-status'), 'Python stopped');
    assert.equal(await metaOf(page, 1), 'Python stopped while this cell was running.');
    await press(page, 'Run All');
    await page.waitForFunction(() => window.__kernel.started.length === 2);
  },
  {
    files: {
      'hw.ipynb': notebook([
        ['code', 'import os; os._exit(0)'],
        ['code', "print('x')"],
      ]),
    },
  },
);

uiTest(
  'without ipykernel the notebook shows the command and puts it in a terminal',
  async (page) => {
    await openNotebook(page);
    await press(page, 'Run All');
    await page.waitForSelector('.nb-notice:not([hidden]) .nb-fix');
    assert.match(await text(page, '.nb-notice'), /ipykernel is not installed/);
    assert.equal(await text(page, '.nb-fix code'), 'uv add --dev ipykernel');
    await page.click('.nb-fix button');
    await page.waitForFunction(() => Object.values(window.__term.input).flat().includes('uv add --dev ipykernel'));
    // After installing, running again starts a kernel without restarting anything.
    await page.evaluate(() => (window.__MOCK__.notebookProblem = null));
    await press(page, 'Run All');
    await waitForText(page, 0, 'hi');
    assert.equal(await page.evaluate(() => document.querySelector('.nb-notice').hidden), true);
  },
  {
    files: { 'hw.ipynb': notebook([['code', "print('hi')"]]) },
    notebookProblem: {
      kind: 'no-ipykernel',
      title: 'ipykernel is not installed',
      detail: 'Install it, then run the cell again.',
      fix: 'uv add --dev ipykernel',
    },
  },
);

uiTest(
  'too many kernels at once is a clear message',
  async (page) => {
    await openNotebook(page);
    await press(page, 'Run All');
    await page.waitForSelector('.nb-notice:not([hidden])');
    assert.match(await text(page, '.nb-notice'), /At most 3 notebooks/);
  },
  { files: { 'hw.ipynb': BASIC }, notebookStartError: 'At most 3 notebooks can run Python at once.' },
);

uiTest(
  'progress bars redraw one line and long output is folded',
  async (page) => {
    await openNotebook(page);
    await press(page, 'Run All');
    await waitForText(page, 1, 'more lines');
    assert.equal(await outputsOf(page, 0), '100%|██████████| 10/10');
    assert.match(await outputsOf(page, 1), /line 100\n.*2,700 more lines · Show all.*\nline 2801\n/s);
    await page.click('.nb-more');
    assert.equal((await outputsOf(page, 1)).split('\n').length, 3001);
  },
  {
    files: {
      'hw.ipynb': notebook([
        ['code', 'progress()'],
        ['code', 'spam(3000)'],
      ]),
    },
  },
);

uiTest(
  'closing a notebook stops its kernel; a running one asks first',
  async (page) => {
    await openNotebook(page);
    await press(page, 'Run All');
    await page.waitForSelector('.nb-cell.running');
    assert.match(await page.evaluate(() => window.__requestClose().then(() => window.__confirmed)), /still running a cell/);
    await page.evaluate(() => (window.__MOCK__.confirm = false));
    await page.evaluate(() => window.__emit('menu', 'close-tab'));
    await sleep(50);
    assert.match(await page.evaluate(() => window.__confirmed), /hw\.ipynb has unsaved changes and is still running/);
    assert.equal(await count(page, '#tabs .tab'), 1, 'kept open');
    await page.evaluate(() => (window.__MOCK__.confirm = true));
    await page.evaluate(() => window.__emit('menu', 'close-tab'));
    await page.waitForFunction(() => window.__kernel.stopped.length === 1);
    assert.equal(await count(page, '.notebook'), 0);
  },
  { files: { 'hw.ipynb': notebook([['code', 'while True:\n    pass']]) } },
);

uiTest(
  'a notebook changed on disk reloads, and one with unsaved edits asks',
  async (page) => {
    await openNotebook(page);
    await page.evaluate((text) => window.__changeOnDisk('hw.ipynb', text), notebook([['code', 'from_disk = 1']]));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.querySelector('.nb-cell .cm-content').textContent === 'from_disk = 1');
    await editCell(page, 0);
    await page.keyboard.type(' # mine');
    await page.evaluate((text) => window.__changeOnDisk('hw.ipynb', text), notebook([['code', 'again = 2']]));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForSelector('#editor-banner:not([hidden])');
    assert.match(await text(page, '#editor-banner'), /changed on disk/);
    await page.click('#editor-banner button:nth-child(2)');
    await page.waitForFunction(() => document.querySelector('.nb-cell .cm-content').textContent === 'again = 2');
    assert.equal(await count(page, '#tabs .tab.dirty'), 0);
  },
  { files: { 'hw.ipynb': BASIC } },
);

uiTest(
  'a failed save keeps the changes and says why',
  async (page) => {
    await openNotebook(page);
    await editCell(page, 1);
    await page.keyboard.type('!');
    await page.evaluate(() => window.__emit('menu', 'save'));
    await page.waitForSelector('#editor-banner:not([hidden])');
    assert.match(await text(page, '#editor-banner'), /was not saved.*permission/);
    assert.equal(await count(page, '#tabs .tab.dirty'), 1);
    assert.match(await page.evaluate(() => window.__requestClose().then(() => window.__confirmed)), /unsaved changes/);
  },
  { files: { 'hw.ipynb': BASIC }, readOnly: ['hw.ipynb'] },
);

uiTest(
  'a malformed notebook says why and can be opened as text',
  async (page) => {
    await page.click('#tree .node[data-path="broken.ipynb"]');
    await page.waitForSelector('.editor-notice:not([hidden])');
    assert.match(await text(page, '.editor-notice h2'), /could not be read as a notebook/);
    await page.click('.notice-actions button');
    await page.waitForSelector('.cm-editor:not([hidden]) .cm-content');
    assert.match(await page.$eval('#editor-host > .cm-editor .cm-content', (n) => n.textContent), /"cells": \[/);
    await page.click('#tree .node[data-path="old.ipynb"]');
    await page.waitForFunction(() => document.querySelector('.editor-notice h2')?.textContent.includes('another notebook format'));
    assert.match(await text(page, '.editor-notice p'), /format 3/);
  },
  { files: { 'broken.ipynb': '{\n "cells": [\n', 'old.ipynb': '{"nbformat": 3, "nbformat_minor": 0, "worksheets": []}' } },
);

uiTest(
  'a notebook too large to open says how to make it smaller',
  async (page) => {
    await page.click('#tree .node[data-path="huge.ipynb"]');
    await page.waitForSelector('.editor-notice:not([hidden])');
    assert.match(await text(page, '.editor-notice'), /opens notebooks up to 20 MB.*nbconvert --clear-output/);
  },
  { files: { 'huge.ipynb': '' }, disk: { 'huge.ipynb': { kind: 'tooLarge', size: 64e6, limit: 20e6 } } },
);

const HOSTILE = notebook([
  [
    'markdown',
    '<script>window.__pwned = "markdown"</script>\n\n<img src=x onerror="window.__pwned = \'img\'">\n\n[click](javascript:window.__pwned=1) <a href="https://example.com/x">site</a>\n\n![remote](https://example.com/tracker.png)',
  ],
  [
    'code',
    'show()',
    {
      count: 1,
      outputs: [
        {
          output_type: 'display_data',
          metadata: {},
          data: {
            'text/html':
              '<script>window.__pwned = "html"</script><img src="https://example.com/p.png" onerror="window.__pwned=2"><a href="javascript:window.__pwned=3" id="js">x</a><iframe src="https://example.com"></iframe><style>body{display:none}</style><svg onload="window.__pwned=4"><script>window.__pwned=5</script></svg><form action="https://example.com"><input></form>',
            'text/plain': 'html',
          },
        },
        {
          output_type: 'display_data',
          metadata: {},
          data: {
            'image/svg+xml':
              '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__pwned=6"><script>window.__pwned=7</script><image href="https://example.com/i.png"/></svg>',
          },
        },
        {
          output_type: 'display_data',
          metadata: {},
          data: { 'application/javascript': 'window.__pwned = 8', 'text/plain': '<IPython.core.display.Javascript object>' },
        },
        {
          output_type: 'display_data',
          metadata: {},
          data: { 'application/vnd.jupyter.widget-view+json': { model_id: 'abc' }, 'text/plain': 'IntSlider(value=3)' },
        },
      ],
    },
  ],
]);

uiTest(
  'nothing in a notebook can run, load from the network or navigate',
  async (page) => {
    const remote = [];
    page.on('request', (request) => !request.url().startsWith('file:') && !request.url().startsWith('data:') && remote.push(request.url()));
    await openNotebook(page);
    await sleep(300);
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    assert.deepEqual(remote, []);
    assert.equal(await count(page, '.notebook script, .notebook iframe, .notebook style, .notebook form, .nb-html svg, .nb-markdown svg:not(.katex *)'), 0);
    assert.equal(await page.$$eval('.notebook a', (links) => links.filter((a) => a.getAttribute('href')?.startsWith('javascript')).length), 0);
    assert.equal(await page.$eval('.nb-rendered a[href]', (a) => a.getAttribute('href')), 'https://example.com/x');
    assert.match(await text(page, '.nb-rendered'), /\[image: remote\]/);
    assert.equal(await page.$eval('.nb-output img.nb-image', (img) => img.src.startsWith('data:image/svg+xml')), true, 'SVG only as an image');
    const placeholders = await page.$$eval('.nb-unsupported', (nodes) => nodes.map((n) => n.textContent));
    assert.deepEqual(placeholders, [
      'JavaScript output. Longhand does not run scripts from notebooks.',
      'An interactive widget. Longhand does not show widgets; open the notebook in Jupyter to use it.',
    ]);
    // Clicking the javascript: link does nothing.
    await page.click('#js');
    await sleep(100);
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    assert.ok(page.url().endsWith('index.html'));
  },
  { files: { 'hw.ipynb': HOSTILE } },
);

uiTest(
  'the tutor knows which notebook and cell the student is in',
  async (page) => {
    await openNotebook(page);
    await editCell(page, 2);
    await page.waitForSelector('#tutor .chip, #tutor [data-key="file"]');
    const title = await page.evaluate(() => [...document.querySelectorAll('#tutor [title]')].map((n) => n.title).find((t) => t.includes('hw.ipynb')));
    assert.match(title, /hw\.ipynb/);
  },
  { files: { 'hw.ipynb': BASIC } },
);

uiTest(
  'reviewing a notebook is declined plainly',
  async (page) => {
    await openNotebook(page);
    await page.evaluate(() => window.__emit('menu', 'review-file'));
    assert.match(await text(page, '#status-msg'), /does not cover notebooks/);
  },
  { files: { 'hw.ipynb': BASIC } },
);
