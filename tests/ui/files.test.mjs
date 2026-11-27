import assert from 'node:assert/strict';
import { count, openFromTree, text, uiTest } from './helpers.mjs';

const labels = (page) => page.$$eval('#tree .node .label', (n) => n.map((x) => x.textContent));
const focused = (page) => page.$eval('#tree .focused', (n) => n.dataset.key);
const menuItems = (page) => page.$$eval('.ctx-item .ctx-label', (n) => n.map((x) => x.textContent));
const clickMenuItem = (page, label) =>
  page.$$eval('.ctx-item', (items, label) => items.find((i) => i.querySelector('.ctx-label').textContent === label).click(), label);
const revealLabel = (page) => page.evaluate(() => (navigator.platform.startsWith('Mac') ? 'Reveal in Finder' : 'Show in File Manager'));
const changeOnDisk = (page, paths, root = '/demo/running-stats') =>
  page.evaluate((root, paths) => window.__emit('files:changed', { root, paths }), root, paths);

// ---- find in files ----

uiTest('finds text across files, grouped by file, and jumps to the line', async (page) => {
  await page.click('#toggle-search');
  await page.type('#search-input', 'sum_sq');
  await page.waitForSelector('#search-results .hit');
  assert.equal(await count(page, '#search-results .hit'), 3);
  assert.equal(await count(page, '#search-results .hit-file'), 1);
  assert.equal(await text(page, '#search-summary'), '3 results in 1 file');
  assert.equal(await text(page, '.hit-group .hit-count'), '3');
  assert.deepEqual(await page.$$eval('.hit-match', (n) => n.map((x) => x.textContent)), ['sum_sq', 'sum_sq', 'sum_sq']);
  await page.click('#search-results .hit');
  await page.waitForSelector('.cm-content');
  assert.equal(await text(page, '#status-pos'), 'Ln 8, Col 1');
});

const activeResult = (page) => page.$eval('#search-results .active', (n) => n.textContent);

uiTest('arrow keys move through files and hits, and Enter opens one', async (page) => {
  await page.evaluate(() => window.__emit('menu', 'find-in-files'));
  await page.type('#search-input', 'push');
  await page.waitForSelector('#search-results .hit');
  await page.keyboard.press('ArrowDown');
  assert.equal(await activeResult(page), '10def push(self, x: float) -> None:');
  await page.keyboard.press('ArrowDown');
  assert.equal(await activeResult(page), 'test_running.pytests2', 'the next file’s header');
  assert.equal(await page.$eval('#search-results .active', (n) => n.getAttribute('aria-selected')), 'true');

  // Left folds a file's hits away and right brings them back.
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.$eval('.hit-file.active', (n) => n.getAttribute('aria-expanded')), 'false');
  assert.equal(await page.$$eval('.hit-group.collapsed .hit', (n) => n.every((x) => !x.offsetParent)), true);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(await activeResult(page), '7s.push(x)');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await activeResult(page), 'test_running.pytests2', 'left from a hit goes to its file');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.cm-content');
  assert.equal(await text(page, '#status-file'), 'tests/test_running.py');
  assert.equal(await text(page, '#status-pos'), 'Ln 7, Col 1');
});

uiTest('match case and whole word narrow the search', async (page) => {
  await page.click('#toggle-search');
  await page.type('#search-input', 'Running');
  await page.waitForSelector('#search-results .hit');
  const all = await count(page, '#search-results .hit');
  await page.click('#search-case');
  await page.waitForFunction((all) => document.querySelectorAll('#search-results .hit').length < all, {}, all);
  assert.equal(await page.$eval('#search-case', (n) => n.getAttribute('aria-pressed')), 'true');
  assert.ok((await text(page, '#search-results')).includes('RunningStats'));

  await page.click('#search-case');
  await page.$eval('#search-input', (n) => (n.value = ''));
  await page.type('#search-input', 'mean');
  await page.waitForFunction(() => document.querySelector('#search-summary').textContent.startsWith('5 results'));
  await page.click('#search-word');
  // "test_mean" no longer counts.
  await page.waitForFunction(() => document.querySelector('#search-summary').textContent.startsWith('4 results'));
});

uiTest(
  'the match stays in view on a long line',
  async (page) => {
    await page.click('#toggle-search');
    await page.type('#search-input', 'target_word');
    await page.waitForSelector('#search-results .hit');
    const shown = await text(page, '.hit-text');
    assert.ok(shown.startsWith('…'), shown);
    const visible = await page.$eval('.hit-match', (mark) => mark.getBoundingClientRect().right <= mark.closest('.hit-text').getBoundingClientRect().right);
    assert.ok(visible, 'the match is not cut off by the ellipsis');
  },
  { files: { 'long.py': 'result = some_really_long_function_name_here(argument_one, argument_two, target_word)\n' } },
);

uiTest('a search with no matches says so', async (page) => {
  await page.click('#toggle-search');
  await page.type('#search-input', 'nothing like this');
  await page.waitForSelector('#search-results .empty-state');
  assert.equal(await text(page, '#search-results'), 'No matches.');
});

// ---- the tree's menu and naming ----

uiTest('the file tree menu creates, renames, copies paths, reveals and trashes', async (page) => {
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => (window.__copied = t) } }));
  await page.click('#tree .node[data-path="README.md"]', { button: 'right' });
  assert.deepEqual(await menuItems(page), ['New File…', 'New Folder…', 'Rename…', 'Move to Trash', 'Copy Path', 'Copy Relative Path', await revealLabel(page)]);
  await clickMenuItem(page, 'New File…');
  await page.type('#tree .new-name', 'notes.md');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#tree .node[data-path="notes.md"]');
  assert.equal(await text(page, '#status-file'), 'notes.md');
  assert.equal(await count(page, '#tabs .tab.dirty'), 0, 'the Enter that named the file did not type into it');

  await page.click('#tree .node[data-path="notes.md"]', { button: 'right' });
  await clickMenuItem(page, 'Rename…');
  assert.equal(await page.$eval('#tree .new-name', (n) => n.value.slice(n.selectionStart, n.selectionEnd)), 'notes', 'the extension is not selected');
  await page.keyboard.type('journal');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#tree .node[data-path="journal.md"]');
  assert.equal(await text(page, '#tabs .tab.active span'), 'journal.md');

  await page.click('#tree .node[data-path="journal.md"]', { button: 'right' });
  await clickMenuItem(page, 'Copy Path');
  await page.waitForFunction(() => window.__copied === '/demo/running-stats/journal.md');
  await page.click('#tree .node[data-path="journal.md"]', { button: 'right' });
  await clickMenuItem(page, 'Copy Relative Path');
  await page.waitForFunction(() => window.__copied === 'journal.md');
  await page.click('#tree .node[data-path="journal.md"]', { button: 'right' });
  await clickMenuItem(page, await revealLabel(page));
  await page.waitForFunction(() => window.__revealed?.[0] === 'journal.md');

  await page.click('#tree .node[data-path="journal.md"]', { button: 'right' });
  await clickMenuItem(page, 'Move to Trash');
  await page.waitForFunction(() => !document.querySelector('#tree .node[data-path="journal.md"]'));
  assert.equal(await count(page, '#tabs .tab'), 0);
});

uiTest('a new folder appears inside the folder it was made in', async (page) => {
  await page.click('#tree .node[data-path="stats"]', { button: 'right' });
  await clickMenuItem(page, 'New Folder…');
  await page.type('#tree .new-name', 'helpers');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#tree .node[data-path="stats/helpers"]');
  assert.equal(await page.$eval('#tree .node[data-path="stats/helpers"]', (n) => n.getAttribute('aria-level')), '2');
});

uiTest('naming checks the name as it is typed', async (page) => {
  await page.click('#tree .node[data-path="stats"]', { button: 'right' });
  await clickMenuItem(page, 'New File…');
  const problem = () => text(page, '.name-problem');
  await page.type('#tree .new-name', 'running.py');
  assert.equal(await problem(), 'A file named “running.py” is already here.');
  await page.$eval('#tree .new-name', (n) => ((n.value = 'a:b.py'), n.dispatchEvent(new Event('input'))));
  assert.equal(await problem(), 'Names cannot contain \\ or :.');
  await page.$eval('#tree .new-name', (n) => ((n.value = '../x.py'), n.dispatchEvent(new Event('input'))));
  assert.equal(await problem(), '“.” and “..” cannot be used as names.');
  await page.$eval('#tree .new-name', (n) => ((n.value = ''), n.dispatchEvent(new Event('input'))));
  assert.equal(await problem(), '');
  await page.keyboard.press('Enter');
  assert.equal(await problem(), 'Type a name.', 'an empty name is only an error once submitted');
  assert.equal(await page.$eval('.naming-row', (n) => n.classList.contains('invalid')), true);

  await page.type('#tree .new-name', 'variance.py');
  assert.equal(await problem(), '');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#tree .node[data-path="stats/variance.py"]');
  assert.equal(await page.evaluate(() => 'stats/variance.py' in window.__files), true);
});

uiTest('a name the backend refuses keeps the field open with the reason', async (page) => {
  // A folder is a prefix of a path in the mock, so "stats/__init__.py/x" clashes with a file.
  await page.click('#tree .node[data-path="stats"]', { button: 'right' });
  await clickMenuItem(page, 'New File…');
  await page.type('#tree .new-name', '__init__.py/x.py');
  assert.equal(await text(page, '.name-problem'), 'A file named “__init__.py” is already here.');
  await page.$eval('#tree .new-name', (n) => ((n.value = 'notes/a.py'), n.dispatchEvent(new Event('input'))));
  await page.evaluate(() => {
    window.__mock.commands.fs_create = () => {
      throw 'Permission denied (os error 13)';
    };
  });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.name-problem').textContent === 'Permission denied (os error 13)');
  assert.equal(await count(page, '#tree .new-name'), 1);
  await page.keyboard.press('Escape');
  assert.equal(await count(page, '#tree .new-name'), 0);
});

uiTest(
  'a renamed file keeps tracking unsaved edits',
  async (page) => {
    await page.click('#tree .node[data-path="draft.py"]');
    await page.waitForSelector('.cm-content');
    await page.click('#tree .node[data-path="draft.py"]', { button: 'right' });
    await clickMenuItem(page, 'Rename…');
    await page.$eval('#tree .new-name', (n) => (n.value = 'final.py'));
    await page.keyboard.press('Enter');
    await page.waitForSelector('#tree .node[data-path="final.py"]');

    await page.click('.cm-content');
    await page.keyboard.type('y = 2');
    assert.equal(await count(page, '#tabs .tab.dirty'), 1);
    await page.evaluate(() => window.__emit('menu', 'save'));
    await page.waitForFunction(() => !document.querySelector('#tabs .tab.dirty'));
    assert.match(await page.evaluate(() => window.__files['final.py']), /y = 2/);
    assert.equal(await page.evaluate(() => 'draft.py' in window.__files), false);
  },
  { files: { 'draft.py': 'x = 1\n' } },
);

// ---- keyboard ----

uiTest('the tree works from the keyboard', async (page) => {
  await page.focus('#tree');
  assert.equal(await focused(page), 'stats');
  await page.keyboard.press('ArrowRight');
  await page.waitForSelector('#tree .node[data-path="stats/running.py"]');
  assert.equal(await page.$eval('#tree .node[data-path="stats"]', (n) => n.getAttribute('aria-expanded')), 'true');
  await page.keyboard.press('ArrowRight');
  assert.equal(await focused(page), 'stats/__init__.py');
  await page.keyboard.press('ArrowDown');
  assert.equal(await focused(page), 'stats/running.py');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await focused(page), 'stats', 'left goes to the parent folder');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => !document.querySelector('#tree .node[data-path="stats/running.py"]'));

  // Type-ahead jumps to the next name starting with what was typed.
  await page.keyboard.type('re');
  assert.equal(await focused(page), 'README.md');
  await page.keyboard.press('Home');
  assert.equal(await focused(page), 'stats');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.cm-content');
  assert.equal(await text(page, '#status-file'), 'README.md');
});

uiTest('F2 renames and ⌘⌫ moves to the Trash from the tree', async (page) => {
  await page.focus('#tree');
  await page.keyboard.press('End');
  await page.keyboard.press('F2');
  await page.waitForSelector('#tree .new-name');
  await page.keyboard.type('NOTES');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#tree .node[data-path="NOTES.md"]');
  assert.equal(await focused(page), 'NOTES.md', 'the renamed row keeps the focus');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tree');

  await page.keyboard.down('Meta');
  await page.keyboard.press('Backspace');
  await page.keyboard.up('Meta');
  await page.waitForFunction(() => !document.querySelector('#tree .node[data-path="NOTES.md"]'));
  assert.equal(await page.evaluate(() => window.__confirmed), 'Move NOTES.md to the Trash?');
  assert.equal(await focused(page), 'pyproject.toml');
});

uiTest('the menu opens from the keyboard and is driven by arrows', async (page) => {
  await page.focus('#tree');
  await page.keyboard.down('Shift');
  await page.keyboard.press('F10');
  await page.keyboard.up('Shift');
  await page.waitForSelector('.ctx-menu');
  assert.equal(await page.$eval('.ctx-item.active .ctx-label', (n) => n.textContent), 'New File…');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.$eval('.ctx-item.active .ctx-label', (n) => n.textContent), await revealLabel(page));
  await page.keyboard.press('Escape');
  assert.equal(await count(page, '.ctx-menu'), 0);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tree');
});

// ---- quick open ----

uiTest(
  'quick open finds files by part of their name, file names first',
  async (page) => {
    await page.evaluate(() => window.__emit('menu', 'quick-open'));
    await page.waitForSelector('#quick-open:not([hidden]) .palette-row');
    await page.keyboard.type('run');
    const shown = () => page.$$eval('#quick-open .palette-row', (n) => n.map((x) => x.dataset.path));
    await page.waitForFunction(() => document.querySelector('#quick-open .palette-row').dataset.path === 'stats/running.py');
    assert.deepEqual(await shown(), ['stats/running.py', 'tests/test_running.py']);
    assert.equal(await page.$eval('#quick-open .palette-row.active .palette-match', (n) => n.textContent), 'run');

    await page.$eval('.palette-input', (n) => (n.value = ''));
    await page.keyboard.type('stats');
    assert.equal((await shown())[0], 'stats_notes.md', 'a match in the file name ranks above one in its folder');

    await page.keyboard.press('ArrowDown');
    assert.equal(await page.$eval('#quick-open .palette-row.active', (n) => n.dataset.path), (await shown())[1]);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.cm-content');
    assert.equal(await text(page, '#status-file'), 'stats_notes.md');
    assert.equal(await page.$eval('#quick-open', (n) => n.hidden), true);
  },
  { files: { 'stats_notes.md': '# notes\n' } },
);

uiTest('quick open lists recently opened files first and Escape closes it', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await page.click('#tree .node[data-path="README.md"]');
  await page.evaluate(() => window.__emit('menu', 'quick-open'));
  await page.waitForSelector('#quick-open:not([hidden]) .palette-row');
  const first = await page.$eval('#quick-open .palette-row', (n) => n.dataset.path);
  assert.equal(first, 'stats/running.py', 'the previous file comes first, not the one showing');
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('#quick-open', (n) => n.hidden), true);
  assert.ok(await page.evaluate(() => !!document.activeElement.closest('.cm-editor')), 'the focus goes back to the editor');
});

uiTest('quick open says when nothing matches', async (page) => {
  await page.evaluate(() => window.__emit('menu', 'quick-open'));
  await page.keyboard.type('zzzz');
  await page.waitForFunction(() => document.querySelector('#quick-open .palette-note').textContent.startsWith('No files match'));
  assert.equal(await count(page, '#quick-open .palette-row'), 0);
});

// ---- staying current ----

uiTest('changes on disk show in the tree and in quick open', async (page) => {
  await page.evaluate(() => (window.__files['checkpoint.pt'] = ''));
  await changeOnDisk(page, ['checkpoint.pt']);
  await page.waitForSelector('#tree .node[data-path="checkpoint.pt"]');

  await page.evaluate(() => delete window.__files['README.md']);
  await changeOnDisk(page, ['']);
  await page.waitForFunction(() => !document.querySelector('#tree .node[data-path="README.md"]'));

  await page.evaluate(() => window.__emit('menu', 'quick-open'));
  await page.keyboard.type('checkpoint');
  await page.waitForFunction(() => document.querySelector('#quick-open .palette-row')?.dataset.path === 'checkpoint.pt');
});

uiTest('changes from a folder that is no longer open are ignored', async (page) => {
  await page.evaluate(() => (window.__files['late.py'] = ''));
  await changeOnDisk(page, ['late.py'], '/demo/previous-folder');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(await count(page, '#tree .node[data-path="late.py"]'), 0);
  await changeOnDisk(page, ['late.py']);
  await page.waitForSelector('#tree .node[data-path="late.py"]');
});

uiTest('the tree reveals the file shown in the editor', async (page) => {
  await page.evaluate(() => window.__emit('menu', 'quick-open'));
  await page.keyboard.type('test_running');
  await page.waitForSelector('#quick-open .palette-row[data-path="tests/test_running.py"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#tree .node.active[data-path="tests/test_running.py"]');
  assert.equal(await page.$eval('#tree .node[data-path="tests"]', (n) => n.getAttribute('aria-expanded')), 'true');
});

uiTest(
  'expanded folders are remembered per folder',
  async (page) => {
    await page.waitForSelector('#tree .node[data-path="tests/test_running.py"]');
    await page.click('#tree .node[data-path="stats"]');
    await page.waitForSelector('#tree .node[data-path="stats/running.py"]');
    await page.waitForFunction(() => window.__treeMemory?.expanded.includes('stats'));
    assert.deepEqual((await page.evaluate(() => window.__treeMemory.expanded)).sort(), ['stats', 'tests']);
  },
  { treeMemory: { expanded: ['tests'], recent: [] } },
);

// ---- big and untidy folders ----

const manyFiles = Object.fromEntries(Array.from({ length: 1200 }, (_, i) => [`data/shard_${String(i).padStart(4, '0')}.txt`, '']));

uiTest(
  'a folder with thousands of entries shows a page at a time',
  async (page) => {
    await page.click('#tree .node[data-path="data"]');
    await page.waitForSelector('#tree .tree-more');
    assert.equal(await count(page, '#tree .node[data-path^="data/"]'), 500);
    assert.equal(await text(page, '#tree .tree-more .label'), 'Show 500 more of 700');
    await page.click('#tree .tree-more');
    await page.waitForFunction(() => document.querySelectorAll('#tree .node[data-path^="data/"]').length === 1000);
  },
  { files: manyFiles },
);

uiTest(
  'generated and ignored folders are quiet but still open',
  async (page) => {
    assert.equal(await page.$eval('#tree .node[data-path=".venv"]', (n) => n.classList.contains('quiet')), true);
    assert.equal(await page.$eval('#tree .node[data-path="data"]', (n) => n.classList.contains('quiet')), true);
    assert.equal(await page.$eval('#tree .node[data-path="stats"]', (n) => n.classList.contains('quiet')), false);
    await page.click('#tree .node[data-path="data"]');
    await page.waitForSelector('#tree .node.quiet[data-path="data/train.txt"]');

    await page.evaluate(() => window.__emit('menu', 'quick-open'));
    await page.keyboard.type('train');
    await page.waitForFunction(() => document.querySelector('#quick-open .palette-note').textContent.startsWith('No files match'));
  },
  { files: { '.venv/lib/site.py': '', 'data/train.txt': 'tokens' }, gitignored: ['data'] },
);

uiTest('an empty folder says so and offers to create a file', async (page) => {
  await page.evaluate(() => {
    for (const path of Object.keys(window.__files)) delete window.__files[path];
  });
  await changeOnDisk(page, ['']);
  await page.waitForSelector('#tree .tree-empty');
  assert.equal(await text(page, '#tree .empty-state'), 'This folder is empty.');
  await page.click('#tree .tree-empty button');
  await page.waitForSelector('#tree .new-name');
  await page.keyboard.type('main.py');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#tree .node[data-path="main.py"]');
  assert.deepEqual(await labels(page), ['main.py']);
});
