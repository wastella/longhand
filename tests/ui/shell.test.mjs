import assert from 'node:assert/strict';
import { text, uiTest } from './helpers.mjs';

uiTest('opens a folder and lists its files, folders first', async (page) => {
  assert.equal(await text(page, '#ws-name'), 'running-stats');
  const names = await page.$$eval('#tree .node .label', (n) => n.map((x) => x.textContent));
  assert.deepEqual(names, ['stats', 'tests', 'pyproject.toml', 'README.md']);
  assert.match(await text(page, '#course-note'), /AGENTS\.md/);
});
