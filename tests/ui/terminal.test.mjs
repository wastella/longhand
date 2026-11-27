import assert from 'node:assert/strict';
import { uiTest } from './helpers.mjs';

uiTest('the terminal starts a shell in the open folder and shows its output', async (page) => {
  await page.waitForFunction(() => document.querySelector('#terminal .xterm-rows')?.textContent.includes('running-stats %'));
  assert.equal(await page.$eval('.tab-btn.active', (n) => n.dataset.pane), 'terminal');
});
