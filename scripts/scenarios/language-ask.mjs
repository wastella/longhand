import { openFromTree } from '../browser.mjs';

export const description = 'A folder where code checking has not been decided: the status bar’s line and the one notification';

export const options = { codeChecking: 'ask', languageServers: { python: 'basedpyright' } };

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  await page.waitForSelector('.notice');
}
