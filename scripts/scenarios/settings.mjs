export const description = 'The settings sheet (⌘,)';

export default async function (page) {
  await page.evaluate(() => window.__emit('menu', 'settings'));
  await page.waitForSelector('.settings-sheet');
}
