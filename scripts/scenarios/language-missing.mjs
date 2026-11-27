import { openFromTree } from '../browser.mjs';

export const description = 'No language server installed for Python: the one notification for the folder, with a quiet status bar';

export const options = { missingServerTold: false };

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  await page.waitForSelector('.notice');
}
