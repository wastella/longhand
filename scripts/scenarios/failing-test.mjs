import { askTutor, openFromTree } from '../browser.mjs';

export const description = 'A failing test sent to the tutor, with its answer (the README screenshot)';

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  // The Run all button only shows on the Tests tab, so press it the way a menu command would.
  await page.evaluate(() => document.querySelector('#run-all-tests').click());
  await page.waitForSelector('#tests-list .test.FAILED');
  await page.click('#tests-list .test.FAILED button');
  await askTutor(
    page,
    'I expected 4.0 because the squared distances from the mean are 4 + 0 + 4, divided by 2. I checked variance() and the division looks right.',
  );
}
