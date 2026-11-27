export const description = 'The file tree with a folder open and the right-click menu on a file';

export default async function (page) {
  await page.click('#tree .node[data-path="stats"]');
  await page.click('#tree .node[data-path="stats/running.py"]', { button: 'right' });
  await page.waitForSelector('.ctx-menu');
}
