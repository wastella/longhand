import { passAfterAsking } from './failure-checkpoint.mjs';

export const description = "The checkpoint after the student's sentence, with the tutor's short reply";

export default async function (page) {
  await passAfterAsking(page);
  await page.type('#tests-detail .fb-checkpoint .fb-expect', 'delta was measured from the old mean');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#tests-detail .fb-checkpoint .msg.tutor') && !document.querySelector('.msg.tutor.streaming'));
}
