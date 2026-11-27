import { openFromTree } from '../browser.mjs';

export const description = 'Find and replace open over stats/running.py, on the second of four matches';

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  await page.click('.cm-content');
  await page.keyboard.down('Meta');
  await page.keyboard.down('Alt');
  await page.keyboard.press('KeyF');
  await page.keyboard.up('Alt');
  await page.keyboard.up('Meta');
  await page.focus('.search-panel input[main-field]');
  await page.keyboard.type('self.count');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.type('.search-panel input[aria-label="Replace with"]', 'self.n');
}
