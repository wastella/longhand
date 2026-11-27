import assert from 'node:assert/strict';
import { count, isHidden, openFromTree, sleep, text, uiTest } from './helpers.mjs';

// CodeMirror's Mod is Cmd on macOS and Ctrl elsewhere.
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Presses a chord such as ['Mod', 'Alt', 'KeyF']. */
async function chord(page, keys) {
  const names = keys.map((key) => (key === 'Mod' ? MOD : key));
  for (const key of names.slice(0, -1)) await page.keyboard.down(key);
  await page.keyboard.press(names.at(-1));
  for (const key of names.slice(0, -1).reverse()) await page.keyboard.up(key);
}

const lines = (page) => page.$$eval('.cm-line', (nodes) => nodes.map((n) => n.textContent));
const tabNames = (page) => page.$$eval('#tabs .tab', (nodes) => nodes.map((n) => n.textContent.replace('×', '')));
const save = (page) => page.evaluate(() => window.__emit('menu', 'save'));
const focusWindow = (page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));

async function typeAt(page, lineIndex, keys) {
  await page.click(`.cm-line:nth-child(${lineIndex + 1})`);
  await page.keyboard.press('End');
  await page.keyboard.type(keys);
}

async function pinNotes(page, path, notes) {
  await page.evaluate(
    (path, notes) => {
      window.__orphaned = [];
      const body = (text) => Object.assign(document.createElement('p'), { textContent: text });
      window.__editor.setNotes(
        'review',
        path,
        notes.map((n) => ({ ...n, body: body(n.text) })),
        { onOrphaned: (id, file) => window.__orphaned.push([id, file]) },
      );
    },
    path,
    notes,
  );
}

const notesOn = (page, path) => page.evaluate((path) => window.__editor.notesOn('review', path), path);

// ---- saving and never losing work ----

uiTest('opens a file in a tab and tracks unsaved edits', async (page) => {
  await openFromTree(page, 'stats/running.py');
  assert.equal(await count(page, '#tabs .tab'), 1);
  assert.equal(await text(page, '#status-file'), 'stats/running.py');
  await page.click('.cm-content');
  await page.keyboard.type('# note\n');
  assert.equal(await count(page, '#tabs .tab.dirty'), 1);
  await save(page);
  await page.waitForFunction(() => !document.querySelector('#tabs .tab.dirty'));
  assert.match(await page.evaluate(() => window.__files['stats/running.py']), /# note\n/);
  assert.match(await text(page, '#status-msg'), /Saved stats\/running\.py/);
});

uiTest('undoing back to the saved text clears the unsaved mark', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await page.click('.cm-content');
  await page.keyboard.type('x');
  assert.equal(await count(page, '#tabs .tab.dirty'), 1);
  await chord(page, ['Mod', 'KeyZ']);
  assert.equal(await count(page, '#tabs .tab.dirty'), 0);
});

uiTest(
  'closing the window with unsaved edits asks first, and backing out keeps it open',
  async (page) => {
    assert.equal(await page.evaluate(() => window.__requestClose()), true, 'nothing unsaved: closes without asking');
    await openFromTree(page, 'stats/running.py');
    await page.click('.cm-content');
    await page.keyboard.type('# draft');
    assert.equal(await page.evaluate(() => window.__requestClose()), false);
    assert.match(await page.evaluate(() => window.__confirmed), /1 file has unsaved changes\. Quit without saving\?/);
  },
  { confirm: false },
);

uiTest(
  'a failed save says why in a banner, keeps the edits, and can be retried',
  async (page) => {
    await openFromTree(page, 'locked.py');
    await page.click('.cm-content');
    await page.keyboard.type('y = 2\n');
    await save(page);
    await page.waitForSelector('#editor-banner:not([hidden])');
    assert.match(await text(page, '#editor-banner'), /locked\.py was not saved\. You don't have permission to save locked\.py\..*Your changes are still here/);
    assert.equal(await count(page, '#tabs .tab.dirty.attention'), 1);
    assert.equal(await page.evaluate(() => window.__files['locked.py']), 'x = 1\n');

    await page.evaluate(() => (window.__MOCK__.readOnly = []));
    await page.click('#editor-banner button');
    await page.waitForFunction(() => document.querySelector('#editor-banner').hidden);
    assert.equal(await page.evaluate(() => window.__files['locked.py']), 'x = 1\ny = 2\n');
    assert.equal(await count(page, '#tabs .tab.dirty'), 0);
  },
  { files: { 'locked.py': 'x = 1\n' }, readOnly: ['locked.py'] },
);

uiTest(
  'saving over a file changed on disk asks first; declining offers the choice in a banner',
  async (page) => {
    await openFromTree(page, 'stats/running.py');
    await page.click('.cm-content');
    await page.keyboard.type('# mine\n');
    await page.evaluate(() => window.__changeOnDisk('stats/running.py', 'theirs\n'));
    await save(page);
    await page.waitForSelector('#editor-banner:not([hidden])');
    assert.match(await page.evaluate(() => window.__confirmed), /changed on disk since you opened it\. Overwrite it/);
    assert.equal(await page.evaluate(() => window.__files['stats/running.py']), 'theirs\n');
    assert.match(await text(page, '#editor-banner'), /running\.py changed on disk/);

    // Keeping mine means the next save overwrites without asking again.
    await page.evaluate(() => (window.__confirmed = null));
    await page.click('#editor-banner button:first-child');
    await save(page);
    await page.waitForFunction(() => window.__files['stats/running.py'].includes('# mine'));
    assert.equal(await page.evaluate(() => window.__confirmed), null);
  },
  { confirm: false },
);

uiTest('a clean file changed on disk reloads in place, keeping the cursor', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await page.click('.cm-line:nth-child(12)');
  assert.match(await text(page, '#status-pos'), /^Ln 12,/);
  await page.evaluate(() => window.__changeOnDisk('stats/running.py', '# formatted\n' + window.__files['stats/running.py']));
  await focusWindow(page);
  await page.waitForFunction(() => document.querySelector('.cm-line').textContent === '# formatted');
  // One line was added above the cursor, so it follows its text down a line.
  assert.match(await text(page, '#status-pos'), /^Ln 13,/);
  assert.equal(await count(page, '#tabs .tab.dirty'), 0);
  assert.equal(await isHidden(page, '#editor-banner'), true);
});

uiTest('a file with unsaved edits that changed on disk asks which version to keep', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await typeAt(page, 0, ' # mine');
  await page.evaluate(() => window.__changeOnDisk('stats/running.py', 'theirs\n'));
  await focusWindow(page);
  await page.waitForSelector('#editor-banner:not([hidden])');
  assert.deepEqual(await page.$$eval('#editor-banner button', (n) => n.map((b) => b.textContent)), ['Keep my version', 'Load the disk version']);
  assert.match((await lines(page))[0], /# mine$/, 'nothing is replaced until the student chooses');

  await page.click('#editor-banner button:last-child');
  await page.waitForFunction(() => document.querySelector('#editor-banner').hidden);
  assert.deepEqual(await lines(page), ['theirs', '']);
  assert.equal(await count(page, '#tabs .tab.dirty'), 0);
});

uiTest('a deleted file closes if clean, and stays open with a way back if not', async (page) => {
  await openFromTree(page, 'README.md');
  await openFromTree(page, 'stats/running.py');
  await typeAt(page, 0, ' # mine');
  await page.evaluate(() => (window.__changeOnDisk('README.md', null), window.__changeOnDisk('stats/running.py', null)));
  await focusWindow(page);
  await page.waitForSelector('#editor-banner:not([hidden])');
  assert.deepEqual(await tabNames(page), ['running.py']);
  assert.match(await text(page, '#editor-banner'), /running\.py was deleted on disk\. Your unsaved version is still open here/);

  await page.click('#editor-banner button:first-child');
  await page.waitForFunction(() => 'stats/running.py' in window.__files);
  assert.match(await page.evaluate(() => window.__files['stats/running.py']), /# mine/);
  assert.equal(await count(page, '#tabs .tab.dirty'), 0);
});

uiTest('moving a file with unsaved edits to the Trash keeps the edits open', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await typeAt(page, 0, ' # mine');
  await page.click('#tree .node[data-path="stats/running.py"]', { button: 'right' });
  await page.click('.ctx-item:nth-of-type(4)');
  await page.waitForFunction(() => !document.querySelector('#tree .node[data-path="stats/running.py"]'));
  assert.deepEqual(await tabNames(page), ['running.py']);
  await page.waitForSelector('#editor-banner:not([hidden])');
  assert.match(await text(page, '#editor-banner'), /was deleted on disk/);
});

uiTest(
  'binary, large and unreadable files get a notice in place of the editor',
  async (page) => {
    await page.click('#tree .node[data-path="data"]');
    await page.click('#tree .node[data-path="data/model.pt"]');
    await page.waitForSelector('.editor-notice:not([hidden])');
    assert.match(await text(page, '.editor-notice'), /model\.pt is not a text file.*1\.4 GB of binary data/);
    await page.click('#tree .node[data-path="data/big.csv"]');
    await page.waitForFunction(() => /too large to edit here.*45 MB/.test(document.querySelector('.editor-notice').textContent));
    await page.click('#tree .node[data-path="data/latin1.txt"]');
    await page.waitForFunction(() => /not UTF-8 text/.test(document.querySelector('.editor-notice').textContent));
    assert.equal(await count(page, '#tabs .tab.notice'), 3);
    await page.click('.editor-notice button');
    assert.equal(await count(page, '#tabs .tab'), 2);
  },
  {
    files: { 'data/model.pt': '', 'data/big.csv': '', 'data/latin1.txt': '' },
    disk: {
      'data/model.pt': { kind: 'binary', size: 1_420_000_000 },
      'data/big.csv': { kind: 'tooLarge', size: 45_000_000 },
      'data/latin1.txt': { kind: 'notText', size: 120 },
    },
  },
);

uiTest('reopening a folder brings back its tabs and the active file', async (page) => {
  await openFromTree(page, 'README.md');
  await openFromTree(page, 'stats/running.py');
  await page.click('.cm-line:nth-child(10)');
  await sleep(500); // the open files are remembered after a short pause
  await page.evaluate(() => window.__emit('workspace:opened', { ...window.__mock.workspace }));
  await page.waitForFunction(() => document.querySelectorAll('#tabs .tab').length === 2);
  assert.deepEqual(await tabNames(page), ['README.md', 'running.py']);
  assert.equal(await text(page, '#status-file'), 'stats/running.py');
  assert.match(await text(page, '#status-pos'), /^Ln 10,/);
});

// ---- tabs ----

uiTest(
  'tabs tell apart files with the same name, close on middle-click, and close to the right',
  async (page) => {
    for (const path of ['stats/__init__.py', 'model/__init__.py', 'README.md']) {
      await openFromTree(page, path);
      if (path.includes('/')) await page.click(`#tree .node[data-path="${path.split('/')[0]}"]`);
    }
    assert.deepEqual(await tabNames(page), ['__init__.pystats', '__init__.pymodel', 'README.md']);
    assert.equal(await page.$eval('#tabs .tab', (n) => n.title), 'stats/__init__.py');

    await page.click('#tabs .tab:nth-child(1)');
    await page.evaluate(() => window.__emit('menu', 'close-tab'));
    assert.equal(await text(page, '#status-file'), 'model/__init__.py', 'the tab to the right takes its place');
    assert.deepEqual(await tabNames(page), ['__init__.py', 'README.md'], 'no hint once the name is unique');

    await page.click('#tabs .tab:nth-child(2)', { button: 'middle' });
    assert.deepEqual(await tabNames(page), ['__init__.py']);
    assert.equal(await text(page, '#status-file'), 'model/__init__.py');
  },
  { files: { 'model/__init__.py': '' } },
);

uiTest('each tab keeps its own cursor', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await page.click('.cm-line:nth-child(14)');
  await openFromTree(page, 'tests/test_running.py');
  await page.click('.cm-line:nth-child(3)');
  await page.click('#tabs .tab:nth-child(1)');
  assert.match(await text(page, '#status-pos'), /^Ln 14,/);
  await page.click('#tabs .tab:nth-child(2)');
  assert.match(await text(page, '#status-pos'), /^Ln 3,/);
});

// ---- editing ----

uiTest('go to line, toggle comment and find with a match count', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await page.click('.cm-content');
  await chord(page, ['Control', 'KeyG']);
  await page.waitForSelector('.go-to-panel input');
  await page.keyboard.type('11:9');
  await page.keyboard.press('Enter');
  assert.equal(await text(page, '#status-pos'), 'Ln 11, Col 9');

  await chord(page, ['Mod', 'Slash']);
  assert.equal((await lines(page))[10], '        # self.count += 1');

  await chord(page, ['Mod', 'KeyF']);
  await page.waitForSelector('.search-panel input[main-field]');
  await page.keyboard.type('self.mean');
  await page.waitForFunction(() => document.querySelector('.search-count').textContent === '3 results');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.search-count').textContent === '2 of 3');
});

uiTest('replace all goes through the app-styled panel', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await page.click('.cm-content');
  await chord(page, ['Mod', 'Alt', 'KeyF']);
  await page.waitForSelector('.search-panel input[aria-label="Replace with"]');
  await page.type('.search-panel input[main-field]', 'sum_sq');
  await page.type('.search-panel input[aria-label="Replace with"]', 'm2');
  await page.$$eval('.search-panel button', (buttons) => buttons.find((b) => b.textContent === 'Replace all').click());
  await save(page);
  await page.waitForFunction(() => !window.__files['stats/running.py'].includes('sum_sq'));
  assert.equal(await page.evaluate(() => window.__files['stats/running.py'].match(/m2/g).length), 3);
});

uiTest(
  'new lines follow the indentation the file already uses',
  async (page) => {
    await openFromTree(page, 'two.py');
    await typeAt(page, 1, '\nz = 3');
    assert.equal((await lines(page))[2], '  z = 3');
  },
  { files: { 'two.py': 'if True:\n  y = 2\n' } },
);

uiTest(
  'saving keeps a file without a final newline that way',
  async (page) => {
    await openFromTree(page, 'bare.py');
    await typeAt(page, 0, ' + 1');
    await save(page);
    await page.waitForFunction(() => window.__files['bare.py'] === 'x = 1 + 1');
  },
  { files: { 'bare.py': 'x = 1' } },
);

// ---- tutor hooks: notes ----

uiTest('notes show a mark and tint, open beneath their lines, and close again', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await pinNotes(page, 'stats/running.py', [
    { id: 'a', fromLine: 5, toLine: 8, text: 'Three running totals.' },
    { id: 'b', fromLine: 12, toLine: 14, text: 'Check the order here.' },
  ]);
  assert.equal(await count(page, '.cm-note-line'), 7);
  assert.equal(await count(page, '.cm-note-mark.start'), 2);
  assert.equal(await count(page, '.cm-note'), 0);

  await page.click('.cm-content');
  await chord(page, ['Alt', 'BracketRight']);
  await page.waitForSelector('.cm-note');
  assert.match(await text(page, '.cm-note'), /Lines 5–8.*Three running totals\./);
  assert.match(await text(page, '#status-pos'), /^Ln 5,/);
  await chord(page, ['Alt', 'BracketRight']);
  assert.match(await text(page, '.cm-note'), /Lines 12–14.*Check the order here\./);
  assert.equal(await count(page, '.cm-note'), 1, 'moving to a note closes the one before');
  await chord(page, ['Alt', 'BracketLeft']);
  assert.match(await text(page, '.cm-note'), /Lines 5–8/);

  await page.keyboard.press('Escape');
  assert.equal(await count(page, '.cm-note'), 0);
  await page.click('.cm-note-gutter .cm-note-mark.start');
  await page.waitForSelector('.cm-note');
  await page.click('.cm-note-hide');
  assert.equal(await count(page, '.cm-note'), 0);
});

uiTest('notes follow edits, and report themselves when their lines are deleted', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await pinNotes(page, 'stats/running.py', [
    { id: 'push', fromLine: 12, toLine: 14, text: 'Order of updates.' },
    { id: 'guard', fromLine: 17, toLine: 18, text: 'One number?' },
  ]);
  await typeAt(page, 1, '\n# a new line above');
  assert.deepEqual(await notesOn(page, 'stats/running.py'), [
    { id: 'push', fromLine: 13, toLine: 15 },
    { id: 'guard', fromLine: 18, toLine: 19 },
  ]);
  // Rewriting a line inside the range keeps the note.
  await page.click('.cm-line:nth-child(14)');
  await page.keyboard.press('End');
  await chord(page, ['Shift', 'Home']);
  await page.keyboard.type('self.mean = self.mean + delta / self.count');
  assert.equal((await notesOn(page, 'stats/running.py'))[0].fromLine, 13);

  // Select lines 18-19 and delete them.
  await page.click('.cm-line:nth-child(18)');
  await page.keyboard.press('Home');
  await page.keyboard.press('Home');
  await chord(page, ['Shift', 'ArrowDown']);
  await chord(page, ['Shift', 'ArrowDown']);
  await page.keyboard.press('Backspace');
  assert.deepEqual(await page.evaluate(() => window.__orphaned), [['guard', 'stats/running.py']]);
  assert.deepEqual(
    (await notesOn(page, 'stats/running.py')).map((n) => n.id),
    ['push'],
  );
});

uiTest('notes for a file that is not open appear when it opens; past the end they are orphaned', async (page) => {
  await pinNotes(page, 'tests/test_running.py', [
    { id: 'mean', fromLine: 4, toLine: 8, text: 'Good first test.' },
    { id: 'gone', fromLine: 400, toLine: 401, text: 'No such line.' },
  ]);
  await openFromTree(page, 'tests/test_running.py');
  assert.equal(await count(page, '.cm-note-mark.start'), 1);
  assert.deepEqual(await page.evaluate(() => window.__orphaned), [['gone', 'tests/test_running.py']]);
  assert.equal(await page.evaluate(() => window.__editor.showNote('review', 'tests/test_running.py', 'mean')), true);
  assert.match(await text(page, '.cm-note'), /Good first test\./);

  await page.evaluate(() => window.__editor.clearNotes('review'));
  assert.equal(await count(page, '.cm-note-mark'), 0);
  const error = await page.evaluate(() => {
    try {
      window.__editor.setNotes('review', 'a.py', [{ id: 'x', fromLine: 3, toLine: 1, body: document.createElement('p') }]);
    } catch (e) {
      return e.message;
    }
  });
  assert.match(error, /1 <= fromLine <= toLine/);
});

// ---- tutor hooks: selection actions ----

uiTest('selecting code offers the registered actions, out of the way of typing', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await page.click('.cm-line:nth-child(12)');
  await chord(page, ['Shift', 'ArrowDown']);
  await sleep(700);
  assert.equal(await count(page, '.selection-actions'), 0, 'nothing is offered when no actions are registered');

  await page.evaluate(() => {
    window.__ran = [];
    window.__editor.registerSelectionAction({ id: 'explain', label: 'Explain', run: (selection) => window.__ran.push(selection) });
  });
  await page.click('.cm-line:nth-child(12)');
  // The first Home stops at the indentation; the second goes to the start of the line.
  await page.keyboard.press('Home');
  await page.keyboard.press('Home');
  await chord(page, ['Shift', 'ArrowDown']);
  await chord(page, ['Shift', 'ArrowDown']);
  await page.waitForSelector('.selection-actions');
  // The selection ends at the start of line 14, which is therefore not part of it.
  await page.click('.selection-actions button');
  const [ran] = await page.evaluate(() => window.__ran);
  assert.deepEqual({ ...ran, text: undefined }, { path: 'stats/running.py', fromLine: 12, toLine: 13, text: undefined });
  assert.match(ran.text, /^ +delta = x - self\.mean\n +self\.mean \+= delta/);
  assert.equal(await count(page, '.selection-actions'), 0);

  // Typing over a selection hides the actions at once.
  await chord(page, ['Shift', 'ArrowUp']);
  await page.waitForSelector('.selection-actions');
  await page.keyboard.type('x');
  assert.equal(await count(page, '.selection-actions'), 0);

  // Alt+Enter reaches them from the keyboard; Escape goes back to the code.
  await chord(page, ['Shift', 'ArrowUp']);
  await chord(page, ['Alt', 'Enter']);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.action), 'explain');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('cm-content')), true);
});
