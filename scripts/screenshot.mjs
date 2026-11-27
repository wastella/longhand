// Saves docs/screenshot.png from the real interface running against the mock backend.
// Usage: npm run screenshot
import { launch, openApp, sleep } from './browser.mjs';

const browser = await launch();
const { page } = await openApp(browser);
await page.click('#tree .node[data-path="stats"]');
await page.click('#tree .node[data-path="stats/running.py"]');
await page.waitForSelector('.cm-content');
await page.evaluate(() => document.querySelector('#run-all-tests').click());
await page.waitForSelector('#tests-list .test.FAILED');
await page.click('#tests-list .test.FAILED button');
await page.type(
  '#input',
  'I expected 4.0 because the squared distances from the mean are 4 + 0 + 4, divided by 2. I checked variance() and the division looks right.',
);
await page.keyboard.press('Enter');
await page.waitForFunction(() => !document.querySelector('#send').hidden && document.querySelector('.msg.tutor'));
await sleep(500);
await page.screenshot({ path: 'docs/screenshot.png' });
await browser.close();
console.log('wrote docs/screenshot.png');
