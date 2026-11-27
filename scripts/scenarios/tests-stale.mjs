import { openFromTree } from '../browser.mjs';

export const description = 'Test results after a save: marked as possibly out of date';

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  await page.evaluate(() => window.__emit('menu', 'run-tests'));
  await page.waitForSelector('#tests-rows .test.FAILED');
  await page.click('.cm-content');
  await page.keyboard.type('# fix');
  await page.evaluate(() => window.__emit('menu', 'save'));
  await page.waitForSelector('#tests-run-stale');
}
