import assert from 'node:assert/strict';
import { count, text, uiTest } from './helpers.mjs';

uiTest('finds text across files and jumps to the line', async (page) => {
  await page.click('#toggle-search');
  await page.type('#search-input', 'sum_sq');
  await page.waitForSelector('#search-results .hit');
  assert.equal(await count(page, '#search-results .hit'), 3);
  await page.click('#search-results .hit');
  await page.waitForSelector('.cm-content');
  assert.equal(await text(page, '#status-pos'), 'Ln 8, Col 1');
});

uiTest('the file tree menu creates, renames and trashes', async (page) => {
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
