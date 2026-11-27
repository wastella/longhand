export const description = 'Find in files with results grouped by file, match case on, and one hit selected';

export default async function (page) {
  await page.click('#toggle-search');
  await page.click('#search-case');
  await page.type('#search-input', 'RunningStats');
  await page.waitForSelector('#search-results .hit');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
}
