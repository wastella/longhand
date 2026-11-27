export const description = 'A coursework folder in the tree: quiet .venv and ignored data, and a naming error';

export const options = {
  files: {
    '.venv/lib/python3.12/site.py': '',
    '.gitignore': 'data/\n',
    'cs336_basics/__pycache__/model.cpython-312.pyc': '',
    'cs336_basics/model.py': '',
    'cs336_basics/tokenizer.py': '',
    'data/TinyStoriesV2-GPT4-train.txt': '',
    'data/owt_valid.txt': '',
  },
  gitignored: ['data'],
};

export default async function (page) {
  await page.click('#tree .node[data-path="cs336_basics"]');
  await page.click('#tree .node[data-path="data"]');
  await page.waitForSelector('#tree .node[data-path="data/owt_valid.txt"]');
  await page.click('#tree .node[data-path="cs336_basics"]', { button: 'right' });
  await page.$$eval('.ctx-item', (items) => items.find((i) => i.textContent.startsWith('New File')).click());
  await page.type('#tree .new-name', 'model.py');
}
