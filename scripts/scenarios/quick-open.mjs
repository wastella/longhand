import { openFromTree } from '../browser.mjs';

export const description = 'Quick open (⌘P) with a query matching file names and folders';

export const options = {
  files: {
    'cs336_basics/model.py': '',
    'cs336_basics/tokenizer.py': '',
    'cs336_basics/train_bpe.py': '',
    'tests/test_model.py': '',
    'tests/test_tokenizer.py': '',
    'tests/_snapshots/test_transformer_lm.npz': '',
  },
};

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  await page.evaluate(() => window.__emit('menu', 'quick-open'));
  await page.waitForSelector('#quick-open .palette-row');
  await page.keyboard.type('tok');
  await page.waitForSelector('#quick-open .palette-row[data-path="cs336_basics/tokenizer.py"]');
}
