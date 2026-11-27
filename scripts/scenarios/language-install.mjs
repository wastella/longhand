import { openFromTree } from '../browser.mjs';

export const description = 'File > Code Checking for This Folder… when no Python server is installed, and the install sheet behind it';

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  await page.waitForFunction(() => window.__lsp.looks.length > 0);
  await page.evaluate(() => window.__emit('menu', 'code-checking'));
  await page.waitForSelector('.checking-sheet');
}
