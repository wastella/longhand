import { readFileSync } from 'node:fs';

export const description = 'A notebook assignment with Markdown, code, a table, a plot and a traceback';

export const options = {
  files: { 'assignment.ipynb': readFileSync(new URL('../../tests/fixtures/notebooks/assignment.ipynb', import.meta.url), 'utf8') },
};

export default async function (page) {
  await page.click('#tree .node[data-path="assignment.ipynb"]');
  await page.waitForSelector('.notebook:not([hidden]) .nb-cell');
}
