export const description = 'A folder with thousands of files, paged, with the keyboard focus on the last row';

export const options = {
  files: Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`checkpoints/step_${String(i * 100).padStart(6, '0')}.pt`, ''])),
};

export default async function (page) {
  await page.click('#tree .node[data-path="checkpoints"]');
  await page.waitForSelector('#tree .tree-more');
  await page.focus('#tree');
  await page.keyboard.press('End');
}
