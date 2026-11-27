export const description = 'A notebook whose folder has no ipykernel: the one command that installs it';

export const options = {
  files: {
    'lab.ipynb': JSON.stringify({
      cells: [{ cell_type: 'code', execution_count: null, id: 'a', metadata: {}, outputs: [], source: 'import numpy as np\nnp.arange(5)' }],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 5,
    }),
  },
  notebookProblem: {
    kind: 'no-ipykernel',
    title: 'ipykernel is not installed',
    detail:
      "Notebooks run in this project's environment (/Users/student/lab/.venv/bin/python3), which does not have ipykernel, the package that runs notebook code. Install it, then run the cell again.",
    fix: 'uv add --dev ipykernel',
  },
};

export default async function (page) {
  await page.click('#tree .node[data-path="lab.ipynb"]');
  await page.waitForSelector('.notebook:not([hidden]) .nb-cell');
  await page.$$eval('.nb-toolbar button', (buttons) => buttons.find((b) => b.textContent.includes('Run All')).click());
  await page.waitForSelector('.nb-notice:not([hidden])');
}
