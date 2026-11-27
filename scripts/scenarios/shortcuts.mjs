export const description = 'Help > Keyboard Shortcuts, generated from the menu bar';

export default async function (page) {
  await page.evaluate(() => window.__emit('menu', 'shortcuts'));
  await page.waitForSelector('.shortcuts-sheet');
}
