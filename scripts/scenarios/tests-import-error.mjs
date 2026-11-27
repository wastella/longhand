export const description = 'A test file that fails to import, so pytest collects nothing';
export const options = { testsProblem: 'collect-error' };

export default async function (page) {
  await page.evaluate(() => (document.getElementById('bottom').style.height = '400px'));
  await page.evaluate(() => window.__emit('menu', 'run-tests'));
  await page.waitForSelector('#tests-detail .tests-message');
}
