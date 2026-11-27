import { openFromTree } from '../browser.mjs';

export const description = 'A failing test asked about beneath it, with the answer (the README screenshot)';

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  // The Run all button only shows on the Tests tab, so press it the way a menu command would.
  await page.evaluate(() => document.querySelector('#run-all-tests').click());
  await page.waitForSelector('#tests-list .test.FAILED');
  await page.click('#tests-list .test.FAILED button');
  await page.type('#tests-detail .fb-expect', '4.0, because the squared distances from the mean are 4 + 0 + 4, divided by 2');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#tests-detail .fb-failure .msg.tutor') && !document.querySelector('.msg.tutor.streaming'));
  await page.evaluate(() => document.querySelector('#tests-detail .fb-failure .msg.tutor').scrollIntoView({ block: 'end' }));
}
