import { openFromTree, sleep } from '../browser.mjs';

export const description = 'Code selected in stats/running.py, with the selection actions offered';

export default async function (page) {
  await page.evaluate(() => {
    window.__editor.registerSelectionAction({ id: 'explain', label: 'Explain', run: () => {} });
    window.__editor.registerSelectionAction({ id: 'ask', label: 'Ask about this', run: () => {} });
  });
  await openFromTree(page, 'stats/running.py');
  const lines = await page.$$('.cm-line');
  const from = await lines[10].boundingBox();
  const to = await lines[13].boundingBox();
  await page.mouse.move(from.x + 1, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width - 2, to.y + to.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForSelector('.selection-actions');
  await sleep(100);
}
