// Shared setup for the interface tests. Each test file runs in its own process (node --test),
// with one headless Chrome for the whole file and a fresh page for every test.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { launch, openApp } from '../../scripts/browser.mjs';

export { askTutor, openFromTree, sleep } from '../../scripts/browser.mjs';

let browser;
before(async () => (browser = await launch()));
after(() => browser?.close());

/**
 * Declares a test that gets a fresh page on the interface, opened on the fixture folder.
 * `options` are passed to the mock backend (see tests/mock/core.js); `options.files` adds files
 * to the fixture folder for this test only. The test also fails if
 * the page throws an uncaught error.
 */
export function uiTest(name, fn, options = {}) {
  test(name, async () => {
    const { page, errors } = await openApp(browser, options);
    try {
      await fn(page);
      assert.deepEqual(errors, [], 'no uncaught errors in the page');
    } finally {
      await page.close();
    }
  });
}

export const text = (page, selector) => page.$eval(selector, (n) => n.textContent);
export const count = (page, selector) => page.$$eval(selector, (n) => n.length);
export const isHidden = (page, selector) => page.$eval(selector, (n) => n.hidden);
