import { openFromTree } from '../browser.mjs';

export const description = 'A language server’s documentation for the name under the pointer';

const code = ['from stats.running import RunningStats', '', 'stats = RunningStats()', 'stats.push(1.0)', ''].join('\n');

export const options = { languageServers: { python: 'basedpyright' }, files: { 'stats/summary.py': code } };

export default async function (page) {
  await openFromTree(page, 'stats/summary.py');
  await page.waitForFunction(() => window.__lsp.docs['file:///demo/running-stats/stats/summary.py']);
  const line = await page.$('.cm-line:nth-child(4)');
  const box = await line.boundingBox();
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.waitForSelector('.cm-lsp-hover-tooltip');
}
