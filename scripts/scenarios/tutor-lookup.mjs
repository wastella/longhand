import { openFromTree } from '../browser.mjs';

export const description = 'The lookup bar (Cmd+Shift+K) with a short answer';

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  await page.evaluate(() => window.__emit('menu', 'lookup'));
  await page.type('#lookup-input', 'what does torch.tril return');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /diagonal/.test(document.querySelector('#lookup-answer').textContent));
}
