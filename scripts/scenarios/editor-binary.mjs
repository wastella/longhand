export const description = 'A model checkpoint clicked in the tree: a notice instead of the editor';

export const options = { files: { 'checkpoints/model.pt': '' }, disk: { 'checkpoints/model.pt': { kind: 'binary', size: 1_420_000_000 } } };

export default async function (page) {
  await page.click('#tree .node[data-path="checkpoints"]');
  await page.click('#tree .node[data-path="checkpoints/model.pt"]');
  await page.waitForSelector('.editor-notice:not([hidden])');
}
