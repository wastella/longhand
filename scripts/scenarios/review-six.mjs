import { openRow, reviewRunning } from './review-notes.mjs';

export const description = 'A review with six notes (the most there can be), a possible bug open';
export const options = { feedback: { review: 'six' } };

export default async function (page) {
  await reviewRunning(page, 6);
  await openRow(page, 4);
}
