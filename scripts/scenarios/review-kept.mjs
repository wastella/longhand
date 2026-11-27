import { openFromTree } from '../browser.mjs';

export const description = 'Notes kept from last time: one open, one resolved, one whose code has gone (outdated)';
const note = (id, fromLine, toLine, anchor, kind, text, status = 'open') => ({
  id,
  path: 'stats/running.py',
  fromLine,
  toLine,
  anchor,
  kind,
  text,
  status,
  thread: `note-${id}`,
  replies: 0,
  created: '',
});
const PUSH = ['        delta = x - self.mean', '        self.mean += delta / self.count', '        self.sum_sq += delta * delta'];
const INIT = ['    def __init__(self) -> None:', '        self.count = 0', '        self.mean = 0.0', '        self.sum_sq = 0.0'];
export const options = {
  feedback: {
    notes: [
      note('a', 12, 14, PUSH, 'question', 'You update `mean` before adding to `sum_sq`. Is `delta` still the distance `sum_sq` needs?'),
      note('b', 5, 8, INIT, 'good', 'Three running totals and no list: this is what makes it a stream.', 'resolved'),
      note('c', 20, 21, ['        values = []', '        values.append(x)'], 'fragile', 'Keeping every value defeats the point of a running statistic.'),
    ],
  },
};

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
  await page.waitForSelector('#fb-summary .fb-group.outdated');
  await page.click('#fb-summary .fb-group.resolved summary');
  await page.click('#fb-summary .fb-group.outdated summary');
}
