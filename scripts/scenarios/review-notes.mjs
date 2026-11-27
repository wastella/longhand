// The review states share these steps; other review-* scenarios import them.
import { openFromTree } from '../browser.mjs';

export const description = 'A review of stats/running.py as three margin notes, one open with a reply';

/** Makes the editor about `width` px wide by widening the tutor panel. */
export const narrow = (page, width = 520) =>
  page.evaluate((w) => {
    const tutor = document.getElementById('tutor');
    const editor = document.getElementById('editor-host');
    tutor.style.width = `${tutor.getBoundingClientRect().width + editor.getBoundingClientRect().width - w}px`;
  }, width);

/** Opens stats/running.py and reviews it, waiting for `rows` notes. */
export async function reviewRunning(page, rows) {
  await openFromTree(page, 'stats/running.py');
  await page.evaluate(() => window.__emit('menu', 'review-file'));
  await page.waitForFunction(
    (n) => document.querySelectorAll('#fb-summary .fb-list .fb-row').length === n && !document.querySelector('#fb-summary .fb-status.running'),
    {},
    rows,
  );
}

/** Opens the note in row `n` of the Notes list. */
export async function openRow(page, n) {
  await page.click(`#fb-summary .fb-list .fb-row:nth-child(${n}) button`);
  await page.waitForSelector('.cm-note .fb-note');
}

/** Replies `text` in the open note and waits for the answer. */
export async function replyInNote(page, text) {
  await page.type('.cm-note .fb-reply-input', text);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.cm-note .fb-thread .msg.tutor') && !document.querySelector('.msg.tutor.streaming'));
}

export default async function (page) {
  await reviewRunning(page, 3);
  await openRow(page, 2);
  await replyInNote(page, 'why does the order matter?');
  await page.click('.cm-note .fb-reply-input');
}
