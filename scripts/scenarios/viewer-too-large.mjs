// A PDF too large to show, in a tab: the calm notice with Reveal in Finder.
export const description = 'A file the viewer cannot show';

export const options = {
  views: { 'data/scanned-textbook.pdf': { error: { code: 'tooLarge', message: 'This file is too large to show.', size: 1_200_000_000 } } },
};

export default async function (page) {
  await page.click('#tree .node[data-path="data"]');
  await page.click('#tree .node[data-path="data/scanned-textbook.pdf"]');
  await page.waitForSelector('#file-view .viewer-problem');
}
