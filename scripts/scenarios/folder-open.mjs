import { recents } from './welcome.mjs';

export const description = 'A folder open with no file yet: shortcuts worth knowing, other recent folders, and notifications';

export const options = { init: { recents }, missing: ['/Volumes/usb/old-homework'] };

export default async function (page) {
  await page.waitForSelector('.welcome-hints');
  // Notifications as other areas raise them; the shell's own module is not reachable from here.
  await page.evaluate(() => window.__emit('tauri://drag-drop', { paths: ['/a', '/b'] }));
  await page.click('.recent[data-path="/Volumes/usb/old-homework"] .recent-open');
  await page.waitForFunction(() => document.querySelectorAll('.notice.error').length === 2);
}
