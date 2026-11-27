import { narrow, openRow, reviewRunning } from './review-notes.mjs';

export const description = 'A review with a single note, open, in a narrow editor';
export const options = {
  feedback: {
    review:
      '<note lines="12-14" kind="question">\nYou update `mean` before adding to `sum_sq`. Write out the first two pushes by hand: is `delta` still the distance that `sum_sq` needs?\n</note>',
  },
};

export default async function (page) {
  await narrow(page);
  await reviewRunning(page, 1);
  await openRow(page, 1);
}
