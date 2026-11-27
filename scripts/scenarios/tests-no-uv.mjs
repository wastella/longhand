export const description = 'Running the tests in a uv project on a Mac without uv: the problem and its fix';
export const options = { testsProblem: 'no-uv' };

export default async function (page) {
  await page.evaluate(() => window.__emit('menu', 'run-tests'));
  await page.waitForSelector('.tests-problem');
}
