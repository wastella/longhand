import { openFromTree } from '../browser.mjs';

export const description = 'Explain on a selection: the explanation in a note on lines 12–14';

/** Selects `count` whole lines from line `from`. */
export async function selectLines(page, from, count) {
  await page.click(`.cm-line:nth-child(${from})`);
  await page.keyboard.press('Home');
  await page.keyboard.press('Home');
  for (let i = 0; i < count; i++) {
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Shift');
  }
}

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  await selectLines(page, 12, 3);
  await page.waitForSelector('.selection-actions');
  await page.click('.selection-actions button[data-action="explain"]');
  await page.waitForFunction(() => document.querySelector('.cm-note .fb-thread .msg.tutor') && !document.querySelector('.msg.tutor.streaming'));
}
