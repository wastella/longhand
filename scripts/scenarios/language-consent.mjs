import { openFromTree } from '../browser.mjs';

export const description = 'The sheet that turns code checking on for a folder, in the light theme';

export const options = { codeChecking: 'ask', languageServers: { python: 'basedpyright' }, init: { settings: { theme: 'light' } } };

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  await page.waitForSelector('.notice');
  await page.click('.notice .button');
  await page.waitForSelector('.checking-sheet');
}
