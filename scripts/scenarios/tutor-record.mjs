import { askTutor } from '../browser.mjs';

export const description = 'Your record: tutor use in this folder by day';

export const options = {
  tutor: {
    pastDays: [
      { date: '2026-11-25', asks: { question: 5, lookup: 7, review: 1 }, hintRung: 3, reveals: 2 },
      { date: '2026-11-23', asks: { lookup: 2, failure: 1 }, hintRung: 0, reveals: 0 },
    ],
  },
};

export default async function (page) {
  await askTutor(page, 'What is a residual stream?');
  await page.click('#reliance');
  await page.waitForSelector('#record .record-day');
}
