import { openFromTree } from '../browser.mjs';

export const description = 'The hint ladder after its first step, with help open beneath a failing test';

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  await page.click('#stuck');
  await page.type('#input', 'the variance update');
  await page.click('#hints .rung');
  await page.waitForFunction(() => !document.querySelector('#send').hidden && document.querySelector('.msg.tutor'));
  await page.evaluate(() => document.querySelector('#run-all-tests').click());
  await page.waitForSelector('#tests-list .test.FAILED button');
  await page.click('#tests-list .test.FAILED button');
}
