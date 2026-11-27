import assert from 'node:assert/strict';
import { count, openFromTree, text, uiTest } from './helpers.mjs';

uiTest('opens a file in a tab and tracks unsaved edits', async (page) => {
  await openFromTree(page, 'stats/running.py');
  assert.equal(await count(page, '#tabs .tab'), 1);
  assert.equal(await text(page, '#status-file'), 'stats/running.py');
  await page.click('.cm-content');
  await page.keyboard.type('# note\n');
  assert.equal(await count(page, '#tabs .tab.dirty'), 1);
  await page.evaluate(() => window.__emit('menu', 'save'));
  await page.waitForFunction(() => !document.querySelector('#tabs .tab.dirty'));
  assert.match(await page.evaluate(() => window.__files['stats/running.py']), /# note\n/);
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
