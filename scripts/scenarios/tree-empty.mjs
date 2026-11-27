export const description = 'The file tree for a folder with nothing in it yet';

export default async function (page) {
  await page.evaluate(() => {
    for (const path of Object.keys(window.__files)) delete window.__files[path];
    window.__emit('files:changed', { root: '/demo/running-stats', paths: [''] });
  });
  await page.waitForSelector('#tree .tree-empty');
}
