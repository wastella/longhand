import { openFromTree } from '../browser.mjs';

export const description = 'The fixture folder with stats/running.py open';

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
}
