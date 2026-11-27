import { openFromTree } from '../browser.mjs';

export const description = 'A review that failed on the usage limit: the reason in place, with Try again';
export const options = { tutor: { failures: [{ code: 'rate-limited', message: 'Usage limit reached', resetsAt: 1893456000 }] } };

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  await page.evaluate(() => window.__emit('menu', 'review-file'));
  await page.waitForSelector('#fb-summary .msg.error');
}
