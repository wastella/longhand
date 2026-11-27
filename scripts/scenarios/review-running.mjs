import { openFromTree } from '../browser.mjs';

export const description = 'A review streaming in: one note placed, the Notes list showing progress and Stop';
const note = '<note lines="5-8" kind="good">\nThree running totals and no list: this is what makes it a stream.\n</note>\n';
export const options = { feedback: { review: [note, ...Array(200).fill(' ')] } };

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  await page.evaluate(() => window.__emit('menu', 'review-file'));
  await page.waitForSelector('#fb-summary .fb-list .fb-row');
}
