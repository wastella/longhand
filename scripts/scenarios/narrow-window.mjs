import { openFromTree } from '../browser.mjs';

export const description = 'A small window (760×560): the tutor folds away first so the editor keeps its room';

export default async function (page) {
  await page.setViewport({ width: 760, height: 560, deviceScaleFactor: 2 });
  await openFromTree(page, 'stats/running.py');
}
