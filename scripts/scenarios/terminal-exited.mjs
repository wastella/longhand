export const description = 'The shell exited; the terminal offers to start a new one';

export default async function (page) {
  await page.waitForFunction(() => document.querySelector('#terminal .xterm-rows')?.textContent.includes('running-stats %'));
  await page.evaluate(() => window.__emit('term:exit', { id: window.__term.started[0], code: 1 }));
}
