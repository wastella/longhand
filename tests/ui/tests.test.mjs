import assert from 'node:assert/strict';
import { count, text, uiTest } from './helpers.mjs';

uiTest('shows test results with failures first and the traceback', async (page) => {
  await page.evaluate(() => document.querySelector('#run-all-tests').click());
  await page.waitForSelector('#tests-list .test.FAILED');
  const rows = await page.$$eval('#tests-list .test .name', (n) => n.map((x) => x.textContent));
  assert.deepEqual(rows, ['test_variance', 'test_mean']);
  assert.equal(await text(page, '#tests-badge'), '1 failing');
  assert.match(await text(page, '#tests-detail'), /assert 6\.0 == 4\.0/);
  assert.equal(await count(page, '#tests-list .test button'), 1);
});
