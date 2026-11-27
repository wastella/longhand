import { openFromTree } from '../browser.mjs';

export const description = 'No language server installed for Python: the explanation behind the status bar’s quiet line';

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  await page.waitForSelector('#status-language:not([hidden]):not(:disabled)');
  await page.click('#status-language');
  await page.waitForSelector('.language-sheet');
}
