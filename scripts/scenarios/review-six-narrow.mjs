import { narrow, openRow, reviewRunning } from './review-notes.mjs';

export const description = 'Six notes in a narrow editor, one marked "works, but fragile" open';
export const options = { feedback: { review: 'six' } };

export default async function (page) {
  await narrow(page);
  await reviewRunning(page, 6);
  await openRow(page, 5);
}
