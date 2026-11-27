import { openFromTree } from '../browser.mjs';

export const description = 'Fifteen tutor notes on a longer file, all closed';

const lines = Array.from({ length: 60 }, (_, i) => (i % 4 === 0 ? `def step_${i}(x):` : i % 4 === 3 ? '' : `    x = x * ${i} + 1  # stage ${i}`));

export const options = { files: { 'model/train.py': lines.join('\n') + '\n' } };

export default async function (page) {
  await openFromTree(page, 'model/train.py');
  await page.evaluate(() => {
    const notes = Array.from({ length: 15 }, (_, i) => ({
      id: `n${i}`,
      fromLine: i * 4 + 1,
      toLine: i * 4 + (i % 3) + 1,
      body: Object.assign(document.createElement('p'), { textContent: `Note ${i + 1}` }),
    }));
    window.__editor.setNotes('review', 'model/train.py', notes);
  });
}
