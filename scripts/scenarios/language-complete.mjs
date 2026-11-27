import { openFromTree } from '../browser.mjs';

export const description = 'The light theme with a language server: its completions for a member, with documentation, and problems underlined';

const code = ['import nowhere', 'from stats.running import RunningStats', '', 'stats = RunningStats()', 'stats.push(undefined_name)', ''].join('\n');

export const options = { init: { settings: { theme: 'light' } }, languageServers: { python: 'basedpyright' }, files: { 'stats/summary.py': code } };

export default async function (page) {
  await openFromTree(page, 'stats/summary.py');
  await page.waitForSelector('.cm-lintRange-error');
  await page.click('.cm-line:nth-child(5)');
  await page.keyboard.press('End');
  await page.keyboard.type('\nstats.pu');
  // The documentation is placed a frame after it is added.
  await page.waitForFunction(() => document.querySelector('.cm-completionInfo')?.style.top);
}
