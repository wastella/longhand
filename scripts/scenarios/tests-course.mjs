export const description = 'Test results for a larger assignment suite: grouped, failures first, a traceback with library frames';
export const options = { testsSuite: 'course' };

export default async function (page) {
  // The bottom panel dragged taller, as a student reading a failure would.
  await page.evaluate(() => (document.getElementById('bottom').style.height = '460px'));
  await page.evaluate(() => window.__emit('menu', 'run-tests'));
  await page.waitForSelector('#tests-detail .tests-message');
  await page.click('#tests-rows .test[data-id="tests/test_model.py::test_embedding"]');
  await page.click('#tests-detail .tests-library summary');
}
