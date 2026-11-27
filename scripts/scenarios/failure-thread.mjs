import { failingTest } from './failure-help.mjs';

export const description = 'Help on a failing test after the student said what they expected; the failure has since changed';

export default async function (page) {
  await failingTest(page);
  await page.type('#tests-detail .fb-expect', 'variance 4.0, as on paper');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#tests-detail .fb-failure .msg.tutor') && !document.querySelector('.msg.tutor.streaming'));
  await page.evaluate(() => Object.assign(window.__MOCK__, { testOutcomes: { 'tests/test_running.py::test_variance': 'ERROR' } }));
  await page.evaluate(() => window.__emit('menu', 'run-tests'));
  await page.waitForFunction(() => document.querySelector('#tests-detail .fb-changed') && !document.querySelector('#tests-detail .fb-changed').hidden);
}
