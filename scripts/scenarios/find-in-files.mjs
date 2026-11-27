export const description = 'Find in files with results, and one opened at its line';

export default async function (page) {
  await page.click('#toggle-search');
  await page.type('#search-input', 'sum_sq');
  await page.waitForSelector('#search-results .hit');
  await page.click('#search-results .hit');
  await page.waitForSelector('.cm-content');
}
