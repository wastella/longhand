// Clone Repository from the welcome screen, part way through.
export const description = 'Clone Repository from the welcome screen, receiving objects';

export const options = {
  init: { openDir: null, recents: [] },
  waitFor: '#open-folder',
  clone: { slow: true, progress: [['Receiving objects', 62]] },
};

export default async function (page) {
  await page.click('#clone-repository');
  await page.waitForSelector('#clone-url');
  await page.type('#clone-url', 'https://github.com/stanford-cs336/assignment1-basics.git');
  await page.click('#clone-start');
  await page.waitForFunction(() => document.querySelector('#clone-stage').textContent.includes('62%'));
}
