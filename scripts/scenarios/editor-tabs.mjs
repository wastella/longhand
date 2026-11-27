import { openFromTree } from '../browser.mjs';

export const description = 'Many tabs, two files with the same name, one unsaved and changed on disk';

export const options = {
  files: {
    'model/__init__.py': '',
    'model/layers.py': 'import torch\n',
    'model/attention_with_a_very_long_name.py': 'import torch\n',
    'tests/test_layers.py': 'from model.layers import *\n',
  },
};

const paths = [
  'README.md',
  'stats/__init__.py',
  'model/__init__.py',
  'model/layers.py',
  'model/attention_with_a_very_long_name.py',
  'tests/test_layers.py',
  'stats/running.py',
];

export default async function (page) {
  for (const path of paths) {
    await openFromTree(page, path);
    // Opening a file leaves its folder expanded; collapse it so the next path's clicks line up.
    if (path.includes('/')) await page.click(`#tree .node[data-path="${path.split('/')[0]}"]`);
  }
  await page.click('.cm-content');
  await page.keyboard.type('# draft ');
  await page.evaluate(() => window.__changeOnDisk('stats/running.py', window.__files['stats/running.py'] + '\n# formatted\n'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForSelector('#editor-banner:not([hidden])');
}
