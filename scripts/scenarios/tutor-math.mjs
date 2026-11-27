import { askTutor, openFromTree } from '../browser.mjs';

export const description = 'A tutor answer with inline and display math, then a guided-policy code example';

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  await page.click('#policy [data-policy="guided"]');
  await askTutor(page, 'explain the math');
  await askTutor(page, 'please include code');
}
