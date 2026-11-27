export const description = 'A failing test with the tutor\'s one quiet line beneath it: "What did you expect to happen?"';

/** Makes the bottom panel tall enough to show a test's detail with its help. */
export const bigBottom = (page) => page.evaluate(() => (document.getElementById('bottom').style.height = '460px'));

/** Runs the fixture's tests and waits for the failing one's detail. */
export async function failingTest(page) {
  await bigBottom(page);
  await page.evaluate(() => window.__emit('menu', 'run-tests'));
  await page.waitForSelector('#tests-detail .fb-failure');
  await page.waitForFunction(() => document.querySelector('#cancel-tests').hidden);
}

export default async function (page) {
  await failingTest(page);
}
