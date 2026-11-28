// Clone Repository (shell/clone.js) against the mock's clone_start.
import assert from 'node:assert/strict';
import { isHidden, text, uiTest } from './helpers.mjs';

const welcome = { init: { openDir: null, recents: [] }, waitFor: '#open-folder' };
const URL = 'https://github.com/stanford-cs336/assignment1-basics.git';
const clones = (page) => page.evaluate(() => window.__clones);

async function startClone(page, url = URL) {
  await page.click('#clone-repository');
  await page.waitForSelector('#clone-url');
  await page.type('#clone-url', url);
}

uiTest(
  'Clone Repository on the welcome screen clones into the home folder and opens the result',
  async (page) => {
    await startClone(page);
    assert.equal(await page.$eval('#clone-name', (n) => n.value), 'assignment1-basics', 'named after the repository');
    assert.equal(await text(page, '#clone-where'), '/Users/student');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#ws-name').textContent === 'assignment1-basics');
    assert.deepEqual(await clones(page), [{ url: URL, parent: '/Users/student', name: 'assignment1-basics' }]);
    assert.equal(await page.$('.sheet'), null);
  },
  welcome,
);

uiTest(
  'the folder name and location can be changed, and the location is remembered',
  async (page) => {
    await startClone(page, 'git@github.com:course/hw1.git');
    assert.equal(await page.$eval('#clone-name', (n) => n.value), 'hw1');
    await page.click('#clone-name', { count: 3 });
    await page.type('#clone-name', 'homework one');
    await page.click('#clone-choose');
    await page.waitForFunction(() => document.querySelector('#clone-where').textContent === '/Users/student/courses');
    await page.click('#clone-start');
    await page.waitForFunction(() => document.querySelector('#ws-name').textContent === 'homework one');
    assert.deepEqual(await clones(page), [{ url: 'git@github.com:course/hw1.git', parent: '/Users/student/courses', name: 'homework one' }]);
    await page.evaluate(() => window.__emit('menu', 'clone-repository'));
    await page.waitForSelector('#clone-where');
    assert.equal(await text(page, '#clone-where'), '/Users/student/courses');
  },
  { ...welcome, pick: '/Users/student/courses' },
);

uiTest(
  'an empty address is caught before git runs',
  async (page) => {
    await page.click('#clone-repository');
    await page.waitForSelector('#clone-start');
    await page.click('#clone-start');
    assert.match(await text(page, '#clone-error'), /Enter the repository’s address/);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'clone-url');
    assert.deepEqual(await clones(page), []);
  },
  welcome,
);

uiTest(
  'a failed clone explains itself in the sheet and the fields can be fixed',
  async (page) => {
    await startClone(page);
    await page.click('#clone-start');
    await page.waitForFunction(() => !document.querySelector('#clone-error').hidden);
    assert.match(await text(page, '#clone-error'), /could not sign in/);
    assert.equal(await page.$eval('#clone-url', (n) => n.disabled), false);
    assert.equal(await text(page, '#clone-start'), 'Clone');
    assert.equal(await isHidden(page, '.clone-progress'), true);
    assert.equal(await text(page, '#ws-name'), 'Longhand', 'no folder opened');
  },
  { ...welcome, clone: { error: { code: 'auth', message: 'Git could not sign in to this repository.' } } },
);

uiTest(
  'an address the backend refuses is marked on the address field',
  async (page) => {
    await startClone(page, 'ext::sh -c touch% /tmp/x');
    await page.click('#clone-start');
    await page.waitForFunction(() => document.querySelector('#clone-url').classList.contains('invalid'));
    assert.match(await text(page, '#clone-error'), /not supported/);
  },
  { ...welcome, clone: { error: { code: 'invalid-url', message: 'That kind of address is not supported.' } } },
);

uiTest(
  'a clone shows its progress and can be cancelled, by Cancel or by closing the sheet',
  async (page) => {
    await startClone(page);
    await page.click('#clone-start');
    await page.waitForFunction(() => document.querySelector('#clone-stage').textContent === 'Receiving objects… 40%');
    assert.equal(await page.$eval('#clone-url', (n) => n.disabled), true);
    assert.equal(await text(page, '#clone-start'), 'Cloning…');
    await page.click('#clone-cancel');
    await page.waitForFunction(() => !document.querySelector('#clone-url').disabled);
    assert.equal(await isHidden(page, '#clone-error'), true, 'cancelling is not an error');

    await page.click('#clone-start');
    await page.waitForFunction(() => document.querySelector('#clone-url').disabled);
    await page.keyboard.press('Escape');
    assert.equal(await page.$('.sheet'), null);
    assert.equal(await text(page, '#ws-name'), 'Longhand');
  },
  { ...welcome, clone: { slow: true, progress: [['Receiving objects', 40]] } },
);

uiTest(
  'another sheet taking the place of a running clone does not cancel it; it says when it is done',
  async (page) => {
    await startClone(page);
    await page.click('#clone-start');
    await page.waitForFunction(() => document.querySelector('#clone-url').disabled);
    await page.evaluate(() => window.__emit('menu', 'settings'));
    await page.waitForFunction(() => !document.querySelector('#clone-url'));
    assert.deepEqual(await page.evaluate(() => window.__cancelled), []);
    await page.evaluate(() => window.__finishClone());
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.notice')].some((n) => /Cloned into \/Users\/student\/(courses\/)?assignment1-basics/.test(n.textContent)),
    );
    assert.equal(await text(page, '#ws-name'), 'Longhand', 'the folder is offered, not opened over what the student is doing');
  },
  { ...welcome, clone: { slow: true } },
);
