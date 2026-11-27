import { openFromTree } from '../browser.mjs';

export const description = 'Three tutor notes pinned to stats/running.py, one of them open';

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  await page.evaluate(() => {
    const body = (text) => Object.assign(document.createElement('p'), { textContent: text });
    window.__editor.setNotes('review', 'stats/running.py', [
      { id: 'init', fromLine: 5, toLine: 8, body: body('Three running totals and no list: good, this is what makes it a stream.') },
      {
        id: 'push',
        fromLine: 12,
        toLine: 14,
        body: body(
          'You update the mean before adding to sum_sq. Write out the first two pushes by hand: is delta still the distance from the mean that sum_sq needs?',
        ),
      },
      { id: 'small', fromLine: 17, toLine: 18, body: body('What should the variance of a single number be, and does the test agree?') },
    ]);
  });
  await page.evaluate(() => window.__editor.showNote('review', 'stats/running.py', 'push'));
}
