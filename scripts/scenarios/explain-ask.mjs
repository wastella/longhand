import { openFromTree } from '../browser.mjs';
import { selectLines } from './explain-note.mjs';
import { narrow } from './review-notes.mjs';

export const description = '"Ask about this…" on lines 17–18 in a narrow editor: an empty note waiting for the question';

export default async function (page) {
  await narrow(page);
  await openFromTree(page, 'stats/running.py');
  await selectLines(page, 17, 2);
  await page.waitForSelector('.selection-actions');
  await page.click('.selection-actions button[data-action="ask-about"]');
  await page.waitForFunction(() => document.activeElement?.classList.contains('fb-reply-input'));
  await page.keyboard.type('Why 2 and not 1?');
}
