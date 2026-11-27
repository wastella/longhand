import { failingTest } from './failure-help.mjs';

export const description = 'The checkpoint once a test the student asked about passes: one sentence, skippable';

/** Asks about the failing test, then makes it pass. */
export async function passAfterAsking(page) {
  await failingTest(page);
  await page.click('#tests-detail .fb-skip');
  await page.waitForFunction(() => document.querySelector('#tests-detail .fb-failure .msg.tutor') && !document.querySelector('.msg.tutor.streaming'));
  await page.evaluate(() => Object.assign(window.__MOCK__, { testOutcomes: { 'tests/test_running.py::test_variance': 'PASSED' } }));
  await page.evaluate(() => window.__emit('menu', 'run-tests'));
  await page.waitForSelector('#tests-detail .fb-checkpoint');
  await page.waitForFunction(() => document.querySelector('#cancel-tests').hidden);
}

export default async function (page) {
  await passAfterAsking(page);
}
