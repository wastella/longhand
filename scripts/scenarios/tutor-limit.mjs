import { askTutor } from '../browser.mjs';

export const description = 'The usage limit reached, with when it resets and Try again';

export const options = {
  tutor: { failures: [{ code: 'rate-limited', message: 'You have reached your Claude usage limit.', resetsAt: Math.floor(Date.now() / 1000) + 5400 }] },
};

export default async function (page) {
  await askTutor(page, 'Why is my loss NaN after a few hundred steps?');
  await page.waitForSelector('.msg.error');
}
