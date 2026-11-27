import { openFromTree } from '../browser.mjs';

export const description = 'A language server running: an error and a warning underlined, the error’s message on hover';

const code = [
  'import nowhere',
  'from stats.running import RunningStats',
  '',
  '',
  'def summarise(numbers):',
  '    stats = RunningStats()',
  '    for x in numbers:',
  '        stats.push(x)',
  '    return undefined_name.mean',
  '',
].join('\n');

export const options = { languageServers: { python: 'basedpyright' }, files: { 'stats/summary.py': code } };

export default async function (page) {
  await openFromTree(page, 'stats/summary.py');
  await page.waitForSelector('.cm-lintRange-error');
  await page.hover('.cm-lintRange-error');
  await page.waitForSelector('.cm-tooltip-lint');
}
