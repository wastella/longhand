export const description = 'A folder open with no file yet, and a notification';

export default async function (page) {
  await page.waitForSelector('.welcome-folder');
  // A notification as other areas raise them; the shell's own module is not reachable from here.
  await page.evaluate(() => window.__emit('tauri://drag-drop', { paths: ['/a', '/b'] }));
  await page.waitForSelector('.notice.error');
}
