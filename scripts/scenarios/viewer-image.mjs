// A picture open in a tab, and the notice for a file the viewer cannot show.
export const description = 'A picture in a viewer tab';

export const options = { views: { 'figures/plot.png': { png: true } } };

export default async function (page) {
  await page.click('#tree .node[data-path="figures"]');
  await page.click('#tree .node[data-path="figures/plot.png"]');
  await page.waitForSelector('#file-view .image-caption');
}
