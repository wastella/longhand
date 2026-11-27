export const description = 'Three terminals, the third in front, with a progress bar and wide characters';

export default async function (page) {
  await page.waitForFunction(() => window.__term.started.length === 1);
  await page.click('#terminal-add');
  await page.click('#terminal-add');
  await page.waitForFunction(() => window.__term.started.length === 3);
  await page.evaluate(() => window.__termWrite('uv run python train.py\r\nepoch 1:  42%|████▏     | 420/1000 [00:12<00:17, 34.1it/s] 損失=2.31 🙂\r\n', 2));
}
