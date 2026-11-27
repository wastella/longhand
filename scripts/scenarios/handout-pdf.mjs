// The handout pane beside the code, showing a PDF handout.
export const description = 'The handout pane with a PDF beside the code';

export const options = {
  views: { 'assignment1_handout.pdf': { pdf: ['Assignment 1: Running statistics', 'Problem 1: the mean', 'Problem 2: the variance'] } },
};

export default async function (page) {
  await page.click('#tree .node[data-path="stats"]');
  await page.click('#tree .node[data-path="stats/running.py"]');
  await page.waitForSelector('.cm-content');
  await page.click('#toggle-handout-panel');
  await page.waitForSelector('#handout .pdf-page canvas');
  // Pages draw as they come into view; give the first ones time to finish.
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
