import { bigBottom } from './failure-help.mjs';

export const description = 'Starter code raising NotImplementedError: "Where do I start?" instead of debugging';
export const options = { testsSuite: 'course', testsDelay: 1 };

export default async function (page) {
  await bigBottom(page);
  await page.evaluate(() => window.__emit('menu', 'run-tests'));
  await page.waitForFunction(
    () => document.querySelector('#cancel-tests').hidden && document.querySelector('#tests-rows [data-id="tests/test_model.py::test_linear"]'),
  );
  await page.click('#tests-rows [data-id="tests/test_model.py::test_linear"]');
  await page.waitForSelector('#tests-detail .fb-where');
}
