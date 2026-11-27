export const description = 'A notebook at 1280×800 with one cell running and the next waiting';

const cell = (source, i) => ({ cell_type: 'code', execution_count: null, id: `c${i}`, metadata: {}, outputs: [], source });

export const options = {
  files: {
    'train.ipynb': JSON.stringify({
      cells: [
        { cell_type: 'markdown', id: 'm0', metadata: {}, source: '## Training\n\nRun the loop, then plot the loss $\\mathcal{L}(\\theta)$.' },
        cell("print('loading data')", 1),
        cell('progress()\nwhile True:\n    pass', 2),
        cell('plot()', 3),
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }),
  },
};

export default async function (page) {
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await page.click('#tree .node[data-path="train.ipynb"]');
  await page.waitForSelector('.notebook:not([hidden]) .nb-cell');
  await page.$$eval('.nb-toolbar button', (buttons) => buttons.find((b) => b.textContent.includes('Run All')).click());
  await page.waitForSelector('.nb-cell.running');
  await new Promise((resolve) => setTimeout(resolve, 1200));
}
