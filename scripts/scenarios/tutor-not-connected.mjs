import { openFromTree } from '../browser.mjs';

export const description = 'Claude Code is not installed, so the tutor shows its setup steps';

export const options = { auth: { installed: false, loggedIn: false } };

export default async function (page) {
  await openFromTree(page, 'stats/running.py');
}
