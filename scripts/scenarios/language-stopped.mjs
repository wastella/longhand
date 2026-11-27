import { openFromTree } from '../browser.mjs';

export const description = 'The light theme after a language server kept crashing: the notification, and the sheet with what it last said';

export const options = {
  init: { settings: { theme: 'light' } },
  languageServers: { python: { name: 'basedpyright', crashOn: 'initialize' } },
  languageTiming: { restarts: [20, 20, 20] },
};

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  await page.waitForFunction(() => document.querySelector('#status-language')?.textContent === 'Python: language server stopped');
  await page.click('#status-language');
  await page.waitForSelector('.language-sheet');
}
