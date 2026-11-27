export const description = 'A test run in progress: results so far, the count, the clock and the test running now';
export const options = { testsSuite: 'course', testsHangAfter: 9 };

export default async function (page) {
  await page.evaluate(() => (document.getElementById('bottom').style.height = '460px'));
  await page.evaluate(() => window.__emit('menu', 'run-tests'));
  await page.waitForSelector('#tests-rows .test.RUNNING');
}
