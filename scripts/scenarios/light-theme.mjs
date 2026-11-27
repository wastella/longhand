import { openFromTree } from '../browser.mjs';

export const description = 'The light theme, with a file open and a notification';

export const options = { init: { settings: { theme: 'light' } } };

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  await page.evaluate(() => window.__emit('menu', 'run-tests'));
  await page.waitForSelector('#tests-list .test.FAILED');
}
