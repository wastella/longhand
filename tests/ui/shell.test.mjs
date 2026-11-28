import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { count, isHidden, openFromTree, sleep, text, uiTest } from './helpers.mjs';
import { recents } from '../../scripts/scenarios/welcome.mjs';

const menu = (page, id) => page.evaluate((command) => window.__emit('menu', command), id);
const prefs = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__prefs)));
const width = (page, selector) => page.$eval(selector, (n) => n.offsetWidth);
const welcome = { init: { openDir: null, recents }, missing: ['/Volumes/usb/old-homework'], waitFor: '#open-folder' };

// ---- folders ----

uiTest('opens a folder and lists its files, folders first', async (page) => {
  assert.equal(await text(page, '#ws-name'), 'running-stats');
  const names = await page.$$eval('#tree .node .label', (n) => n.map((x) => x.textContent));
  assert.deepEqual(names, ['stats', 'tests', 'pyproject.toml', 'README.md']);
  assert.match(await text(page, '#course-note'), /AGENTS\.md/);
});

uiTest(
  'Open Folder from the menu asks areas with unsaved work first, and backing out stays put',
  async (page) => {
    await openFromTree(page, 'stats/running.py');
    await page.click('.cm-content');
    await page.keyboard.type('# draft');
    await menu(page, 'open-folder');
    await page.waitForFunction(() => window.__confirmed);
    assert.match(await page.evaluate(() => window.__confirmed), /unsaved changes\. Open another folder without saving\?/);
    await sleep(50);
    assert.equal(await text(page, '#ws-name'), 'running-stats');
  },
  { confirm: false, pick: '/Users/ada/other-course' },
);

uiTest(
  'a folder picked from the menu opens and joins the recent list',
  async (page) => {
    await menu(page, 'open-folder');
    await page.waitForFunction(() => document.querySelector('#ws-name').textContent === 'other-course');
    assert.equal((await prefs(page)).recents[0].path, '/Users/ada/other-course');
    assert.equal((await prefs(page)).recents[1].path, '/demo/running-stats', 'the folder that was open before is kept as a recent one');
    assert.equal(await count(page, '#welcome .recent'), 0, 'recent folders are offered only before a folder is open');
  },
  { pick: '/Users/ada/other-course' },
);

uiTest(
  'first launch shows what Longhand is, Open Folder and the recent folders',
  async (page) => {
    assert.match(await text(page, '.welcome-lede'), /write every line/);
    assert.equal(await isHidden(page, '#files'), true, 'no panels before a folder is open');
    const rows = await page.$$eval('.recent', (n) => n.map((r) => [r.querySelector('.recent-name').textContent, r.querySelector('.recent-when').textContent]));
    assert.deepEqual(rows, [
      ['assignment1-basics', 'Today'],
      ['assignment2-systems', 'Yesterday'],
      ['running-stats', '4 days ago'],
      ['old-homework', 'Missing'],
    ]);
    await page.click('.recent[data-path="/demo/running-stats"] .recent-open');
    await page.waitForSelector('#tree .node');
    assert.equal(await isHidden(page, '#files'), false);
  },
  welcome,
);

uiTest(
  'a recent folder that moved says so and can be removed from the list',
  async (page) => {
    await page.click('.recent[data-path="/Volumes/usb/old-homework"] .recent-open');
    await page.waitForSelector('.notice.error');
    assert.match(await text(page, '.notice.error .notice-message'), /no longer exists/);
    await page.click('.notice.error .notice-body button');
    await page.waitForFunction(() => !document.querySelector('.recent[data-path="/Volumes/usb/old-homework"]'));
    assert.equal(await count(page, '.notice'), 0);

    await page.click('.recent[data-path="/demo/running-stats"] .recent-remove');
    await page.waitForFunction(() => !document.querySelector('.recent[data-path="/demo/running-stats"]'));
    assert.deepEqual(
      (await prefs(page)).recents.map((r) => r.name),
      ['assignment1-basics', 'assignment2-systems'],
    );
  },
  welcome,
);

uiTest(
  'reopening the app opens the last folder',
  async (page) => {
    assert.equal(await text(page, '#ws-name'), 'running-stats');
  },
  { init: { openDir: null, lastWorkspace: '/demo/running-stats' } },
);

uiTest('dropping a folder on the window opens it; dropping several explains why not', async (page) => {
  await page.evaluate(() => window.__emit('tauri://drag-enter', { paths: ['/x'] }));
  assert.equal(await page.evaluate(() => document.body.classList.contains('dropping')), true);
  await page.evaluate(() => window.__emit('tauri://drag-drop', { paths: ['/a', '/b'] }));
  assert.equal(await page.evaluate(() => document.body.classList.contains('dropping')), false);
  assert.match(await text(page, '.notice.error'), /one folder at a time/);
  await page.evaluate(() => window.__emit('tauri://drag-drop', { paths: ['/Users/ada/dropped'] }));
  await page.waitForFunction(() => document.querySelector('#ws-name').textContent === 'dropped');
});

// ---- layout ----

uiTest('panels toggle from the menu and the title bar, and the choice is saved', async (page) => {
  await menu(page, 'toggle-files');
  assert.equal(await isHidden(page, '#files'), true);
  assert.equal(await isHidden(page, '.split-v[data-target="files"]'), true);
  assert.equal(await page.$eval('#toggle-files-panel', (n) => n.getAttribute('aria-pressed')), 'false');
  await page.click('#toggle-tutor-panel');
  assert.equal(await isHidden(page, '#tutor'), true);
  await page.click('#hide-bottom');
  assert.equal(await isHidden(page, '#bottom'), true);
  await page.waitForFunction(() => window.__prefs.layout?.panels.bottom.open === false);
  const { panels } = (await prefs(page)).layout;
  assert.deepEqual([panels.files.open, panels.tutor.open, panels.bottom.open], [false, false, false]);
  await menu(page, 'toggle-files');
  assert.equal(await isHidden(page, '#files'), false);
});

uiTest(
  'the saved layout comes back at launch',
  async (page) => {
    assert.equal(await isHidden(page, '#tutor'), true);
    assert.equal(await width(page, '#files'), 300);
    assert.equal(await page.$eval('#bottom', (n) => n.offsetHeight), 180);
  },
  { init: { layout: { panels: { files: { open: true, size: 300 }, tutor: { open: false, size: 400 }, bottom: { open: true, size: 180 } } } } },
);

uiTest('splitters resize by dragging and with the keyboard, and double-click resets', async (page) => {
  const box = await page.$eval('.split-v[data-target="files"]', (n) => n.getBoundingClientRect().toJSON());
  const x = box.x + box.width / 2;
  const y = box.y + 200;
  await page.mouse.move(x + 3, y); // the grip is wider than the 1px line
  await page.mouse.down();
  await page.mouse.move(x + 83, y, { steps: 4 });
  await page.mouse.up();
  assert.equal(await width(page, '#files'), 300);
  await page.click('.split-v[data-target="files"]', { count: 2 });
  assert.equal(await width(page, '#files'), 220);

  await page.focus('.split-v[data-target="tutor"]');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await width(page, '#tutor'), 416);
  await page.waitForFunction(() => window.__prefs.layout?.panels.tutor.size === 416);
});

uiTest('a small window folds the tutor, then the files, and brings them back', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await page.setViewport({ width: 760, height: 600 });
  await page.waitForFunction(() => document.querySelector('#tutor').hidden);
  assert.equal(await isHidden(page, '#files'), false);
  assert.ok((await width(page, '#editor')) >= 360, 'the editor keeps its room');

  // Asking for the tutor in a small window folds the files instead.
  await menu(page, 'toggle-tutor');
  assert.deepEqual([await isHidden(page, '#tutor'), await isHidden(page, '#files')], [false, true]);

  await page.setViewport({ width: 1440, height: 900 });
  await page.waitForFunction(() => !document.querySelector('#files').hidden && !document.querySelector('#tutor').hidden);
  await page.waitForFunction(() => window.__prefs.layout);
  assert.equal((await prefs(page)).layout.panels.files.open, true, 'folding is not the same as closing');
});

// ---- title and status bars ----

uiTest('title bar items show tooltips with their shortcut', async (page) => {
  await page.hover('#toggle-files-panel');
  await page.waitForSelector('.tooltip:not([hidden])');
  assert.match(await text(page, '.tooltip'), /^Hide files⌘B$/);
  await page.mouse.move(700, 500);
  assert.equal(await isHidden(page, '.tooltip'), true);
});

uiTest('the status bar shows the file, its save state and the cursor', async (page) => {
  await openFromTree(page, 'stats/running.py');
  assert.equal(await text(page, '#status-saved'), 'Saved');
  await page.click('.cm-content');
  await page.keyboard.type('x');
  assert.equal(await text(page, '#status-saved'), 'Unsaved');
  await menu(page, 'save');
  await page.waitForFunction(() => document.querySelector('#status-saved').textContent === 'Saved');
});

// ---- themes and settings ----

const surface = (page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-surface').trim());

uiTest(
  'the saved theme applies at launch and changes from the settings sheet',
  async (page) => {
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    assert.equal(await surface(page), '#ffffff');
    assert.equal((await prefs(page)).theme, 'light', 'the window follows');

    await menu(page, 'settings');
    await page.waitForSelector('.settings-sheet');
    const labels = await page.$$eval('.setting-row label', (n) => n.map((x) => x.textContent));
    assert.deepEqual(labels, ['Appearance', 'Code text size', 'Check code as I type']);
    assert.equal(await text(page, '#app-version'), 'Longhand 0.1.0');
    await page.select('#setting-theme', 'dark');
    assert.equal(await surface(page), '#1c1d21');
    assert.equal((await prefs(page)).settings.theme, 'dark');

    await page.keyboard.press('Escape');
    assert.equal(await count(page, '.sheet'), 0);
  },
  { init: { settings: { theme: 'light' } } },
);

uiTest('Match System follows the system appearance as it changes', async (page) => {
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
});

uiTest(
  'text size steps with the menu, is saved, and shows in the settings sheet',
  async (page) => {
    const size = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--code-size'));
    assert.equal(await size(), '15px');
    await menu(page, 'zoom-in');
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--code-size') === '16px');
    assert.equal((await prefs(page)).settings.textSize, 16);
    await menu(page, 'settings');
    assert.equal(await page.$eval('#setting-textSize', (n) => n.value), '16');
    await menu(page, 'zoom-reset');
    await page.waitForFunction(() => document.querySelector('#setting-textSize').value === '13');
  },
  { init: { settings: { textSize: 15 } } },
);

uiTest(
  'a saved value that is no longer valid falls back to the default',
  async (page) => {
    // The default theme is Match System, so the expected theme is whatever this machine prefers.
    const system = await page.evaluate(() => (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), system);
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--code-size')), '13px');
  },
  { init: { settings: { theme: 'purple', textSize: 99 } } },
);

// ---- keyboard ----

uiTest('the shortcut reference lists the menu shortcuts, and Escape returns focus', async (page) => {
  await page.focus('#input');
  await menu(page, 'shortcuts');
  await page.waitForSelector('.shortcuts-sheet');
  const groups = await page.$$eval('.shortcut-group h3', (n) => n.map((x) => x.textContent));
  assert.deepEqual(groups, ['Longhand', 'File', 'Edit', 'View', 'Run', 'Tutor']);
  const tutorRow = await page.$$eval('.shortcut', (rows) => rows.map((r) => r.textContent).find((t) => t.startsWith('Go to Tutor')));
  assert.match(tutorRow, /Go to Tutor⌘4/);
  await page.keyboard.press('Escape');
  assert.equal(await count(page, '.sheet'), 0);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'input');
});

uiTest('Go to Files, Editor, Terminal and Tutor move focus and open hidden panels', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await menu(page, 'toggle-tutor');
  await menu(page, 'focus-tutor');
  assert.equal(await isHidden(page, '#tutor'), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'input');
  await menu(page, 'focus-editor');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('cm-content')), true);
  await menu(page, 'focus-files');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tree', 'the file tree, registered by the files area');
  await menu(page, 'toggle-bottom');
  await menu(page, 'focus-terminal');
  assert.equal(await isHidden(page, '#bottom'), false);
  await page.waitForFunction(() => document.activeElement.closest('#terminal'));
});

// ---- notifications ----

// The notification module, loaded on its own so a test can raise notifications directly.
const notifyModule = pathToFileURL('src/renderer/shell/notify.js').href;

uiTest('notifications stack, fade unless they are errors, and run their action', async (page) => {
  await page.evaluate(async (url) => {
    const { mountNotices, notify } = await import(url);
    mountNotices();
    window.__ran = 0;
    notify({ message: 'Saved notes.md', kind: 'success' });
    notify({ message: 'Could not save', kind: 'error', action: { label: 'Try Again', run: () => window.__ran++ } });
    notify({ message: 'Started a new conversation' });
    notify({ message: 'Started a new conversation' });
  }, notifyModule);
  const kinds = () => page.$$eval('.notice', (n) => n.map((x) => x.dataset.kind));
  assert.deepEqual(await kinds(), ['success', 'error', 'info'], 'a repeated message is not stacked twice');
  assert.equal(await page.$eval('.notice.error', (n) => n.getAttribute('role')), 'alert');
  await page.waitForFunction(() => document.querySelectorAll('.notice').length === 1, { timeout: 8000 });
  assert.deepEqual(await kinds(), ['error']);
  await page.click('.notice.error .notice-body button');
  assert.equal(await page.evaluate(() => window.__ran), 1);
  assert.equal(await count(page, '.notice'), 0);
});

// ---- round 1: quitting, opening folders, sheets, notifications, the shortcut table ----

uiTest(
  'Quit asks areas with unsaved work first, and backing out keeps the app open',
  async (page) => {
    await openFromTree(page, 'stats/running.py');
    await page.click('.cm-content');
    await page.keyboard.type('# draft');
    await menu(page, 'quit');
    await page.waitForFunction(() => window.__confirmed);
    assert.match(await page.evaluate(() => window.__confirmed), /unsaved changes/);
    await sleep(50);
    assert.equal(await page.evaluate(() => window.__quit), undefined);
  },
  { confirm: false },
);

uiTest('Quit with nothing to lose quits straight away', async (page) => {
  await menu(page, 'quit');
  await page.waitForFunction(() => window.__quit === true);
  assert.equal(await page.evaluate(() => window.__confirmed), undefined);
});

uiTest(
  'a folder that cannot be opened is refused before anyone is asked about unsaved work',
  async (page) => {
    await openFromTree(page, 'stats/running.py');
    await page.click('.cm-content');
    await page.keyboard.type('# draft');
    await menu(page, 'open-folder');
    await page.waitForSelector('.notice.error');
    assert.match(await text(page, '.notice.error .notice-message'), /no longer exists/);
    assert.equal(await page.evaluate(() => window.__confirmed), undefined, 'no question about unsaved work');
    assert.equal(await text(page, '#ws-name'), 'running-stats');
  },
  { pick: '/Volumes/usb/gone', missing: ['/Volumes/usb/gone'] },
);

uiTest(
  'only one folder opens at a time',
  async (page) => {
    await page.evaluate(() => window.__emit('tauri://drag-drop', { paths: ['/Users/ada/first'] }));
    await page.evaluate(() => window.__emit('tauri://drag-drop', { paths: ['/Users/ada/second'] }));
    await page.waitForFunction(() => document.querySelector('#ws-name').textContent === 'first');
    await sleep(400);
    assert.equal(await text(page, '#ws-name'), 'first');
    assert.equal(await page.evaluate(() => window.__opened), 2, 'the start-up folder and the first drop');
  },
  { slowOpen: 200 },
);

uiTest(
  'a remembered folder that has gone is shown as missing, without an error',
  async (page) => {
    await page.waitForSelector('.recent.missing[data-path="/Volumes/usb/old-homework"]');
    assert.equal(await count(page, '.notice'), 0);
  },
  {
    init: { openDir: null, lastWorkspace: '/Volumes/usb/old-homework', recents: [{ ...recents[3], exists: null }] },
    missing: ['/Volumes/usb/old-homework'],
    waitFor: '#open-folder',
  },
);

uiTest('a sheet keeps Tab, Shift+Tab and Go to shortcuts inside it, and focuses no control on its own', async (page) => {
  await page.focus('#input');
  await menu(page, 'settings');
  await page.waitForSelector('.sheet');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('sheet')), true);
  assert.equal(await page.evaluate(() => document.getElementById('app').inert), true);
  const inSheet = () => page.evaluate(() => Boolean(document.activeElement.closest('.sheet')));
  await page.keyboard.down('Shift');
  await page.keyboard.press('Tab');
  await page.keyboard.up('Shift');
  assert.equal(await inSheet(), true, 'Shift+Tab from the sheet stays in it');
  await menu(page, 'focus-files');
  assert.equal(await inSheet(), true, 'Go to Files cannot reach behind the sheet');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.getElementById('app').inert), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'input');
});

uiTest('notifications are announced politely, and errors are never pushed out', async (page) => {
  await page.evaluate(async (url) => {
    const { mountNotices, notify } = await import(url);
    mountNotices();
    notify({ message: 'Started a new conversation' });
    for (let i = 1; i <= 5; i++) notify({ message: `Problem ${i}`, kind: 'error' });
  }, notifyModule);
  assert.deepEqual(await page.$$eval('.notices', (n) => n.map((x) => x.getAttribute('aria-live'))), ['polite', 'polite']);
  const kinds = await page.$$eval('.notice', (n) => n.map((x) => x.dataset.kind));
  assert.deepEqual(kinds, ['error', 'error', 'error', 'error', 'error']);
});

uiTest('the mock shortcut table matches the menu in menu.rs', async (page) => {
  const source = readFileSync('src-tauri/src/menu.rs', 'utf8');
  const expected = [];
  let menuName = null;
  for (const line of source.split('\n')) {
    const submenu = line.match(/SubmenuBuilder::new\(app, "([^"]+)"\)/);
    if (submenu) menuName = submenu[1];
    for (const m of line.matchAll(/[^\w](?:item|hinted)\("([^"]+)", "([^"]+)", "([^"]+)"/g))
      expected.push({ id: m[1], menu: menuName, label: m[2], keys: m[3] });
  }
  assert.ok(expected.length > 10, 'menu.rs was read');
  const mocked = await page.evaluate(() => window.__mock.commands.shortcuts_list());
  assert.deepEqual(mocked, expected);
  // No two items share keys; nor do they take the system items' keys (Edit, Window, Hide).
  const taken = [
    'CmdOrCtrl+Z',
    'CmdOrCtrl+Shift+Z',
    'CmdOrCtrl+X',
    'CmdOrCtrl+C',
    'CmdOrCtrl+V',
    'CmdOrCtrl+A',
    'CmdOrCtrl+M',
    'CmdOrCtrl+H',
    'CmdOrCtrl+Alt+H',
  ];
  const keys = [...taken, ...expected.map((s) => s.keys)];
  assert.deepEqual(
    keys.filter((k, i) => keys.indexOf(k) !== i),
    [],
    'shortcuts used twice',
  );
});

uiTest(
  'restored panel sizes are kept within limits, and splitters report their size',
  async (page) => {
    assert.equal(await width(page, '#files'), 640);
    assert.equal(await page.$eval('.split-v[data-target="files"]', (n) => n.getAttribute('aria-valuenow')), '640');
  },
  { init: { layout: { panels: { files: { open: true, size: 5000 }, tutor: { open: false, size: 400 }, bottom: { open: true, size: 180 } } } } },
);

uiTest(
  'the title bar does not claim the tutor is connected when Claude Code is too old',
  async (page) => {
    await page.waitForFunction(() => document.querySelector('#auth').textContent.includes('updating'));
    assert.equal(await page.$eval('#auth', (n) => n.className), 'bad');
  },
  { auth: { installed: true, loggedIn: true, plan: 'max', tooOld: true } },
);

uiTest('Go to Terminal and Go to Tutor land where typing goes', async (page) => {
  await menu(page, 'focus-terminal');
  await page.waitForFunction(() => document.activeElement.classList.contains('xterm-helper-textarea'));
  await menu(page, 'focus-tutor');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'input');
});
