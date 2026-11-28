// The viewer: PDFs and pictures in editor tabs, rendered Markdown, and the handout pane.
import assert from 'node:assert/strict';
import { count, isHidden, sleep, text, uiTest } from './helpers.mjs';

const menu = (page, id) => page.evaluate((command) => window.__emit('menu', command), id);
const PDF = { pdf: ['Assignment 1: Running statistics', 'Problem 1: the mean', 'Problem 2: the variance'] };

async function openInTree(page, path) {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) await page.click(`#tree .node[data-path="${parts.slice(0, i).join('/')}"]`);
  await page.click(`#tree .node[data-path="${path}"]`);
}

/** Reopens the folder, as switching to another folder and back would. */
async function reopenFolder(page, path = '/demo/running-stats') {
  await page.evaluate((dir) => window.__emit('workspace:opened', { ...window.__mock.workspace, path: dir, name: dir.split('/').pop() }), path);
  await sleep(100);
}

const watcherSays = (page, paths) => page.evaluate((changed) => window.__emit('files:changed', { root: window.__mock.workspace.path, paths: changed }), paths);

const pdfText = (host) => (page) => page.$$eval(`${host} .pdf-page .textLayer`, (layers) => layers.map((layer) => layer.textContent));

// ---- PDFs and pictures in tabs ----

uiTest(
  'a PDF opens read-only in a tab, with its pages, selectable text, page controls and zoom',
  async (page) => {
    await openInTree(page, 'docs/handout.pdf');
    await page.waitForSelector('#file-view .pdf-page .textLayer span');
    assert.equal(await count(page, '.cm-editor:not([hidden])'), 0, 'no editor for a PDF');
    assert.equal(await page.$eval('#file-view .pdf-page-input', (n) => n.value), '1');
    assert.equal(await text(page, '#file-view .pdf-page-count'), 'of 3');
    assert.equal(await count(page, '#file-view .pdf-page'), 3);
    assert.deepEqual((await pdfText('#file-view')(page)).slice(0, 1), ['Assignment 1: Running statistics']);
    assert.equal(await page.$eval('#file-view .pdf-fit', (n) => n.getAttribute('aria-pressed')), 'true', 'fits the width at first');

    await page.click('#file-view [aria-label="Next page"]');
    assert.equal(await page.$eval('#file-view .pdf-page-input', (n) => n.value), '2');
    await page.click('#file-view .pdf-page-input', { count: 3 });
    await page.keyboard.type('3');
    await page.keyboard.press('Enter');
    assert.equal(await page.$eval('#file-view .pdf-page-input', (n) => n.value), '3');
    assert.equal(await page.$eval('#file-view [aria-label="Next page"]', (n) => n.disabled), true);
    await page.waitForFunction(() => [...document.querySelectorAll('#file-view .textLayer')].some((n) => n.textContent === 'Problem 2: the variance'));

    const before = await page.$eval('#file-view .pdf-page', (n) => n.offsetWidth);
    await page.click('#file-view [aria-label="Zoom in"]');
    assert.ok((await page.$eval('#file-view .pdf-page', (n) => n.offsetWidth)) > before, 'bigger after zooming in');
    assert.equal(await page.$eval('#file-view .pdf-fit', (n) => n.getAttribute('aria-pressed')), 'false');
    await page.click('#file-view .pdf-fit');
    assert.equal(await page.$eval('#file-view .pdf-page', (n) => n.offsetWidth), before);
  },
  { views: { 'docs/handout.pdf': PDF } },
);

uiTest(
  'a PDF tab remembers its page and zoom',
  async (page) => {
    await openInTree(page, 'docs/handout.pdf');
    await page.waitForSelector('#file-view .pdf-page canvas');
    await page.click('#file-view [aria-label="Next page"]');
    await page.click('#file-view [aria-label="Zoom in"]');
    const zoom = await text(page, '#file-view .pdf-fit');
    await sleep(400);
    await menu(page, 'close-tab');
    await page.click('#tree .node[data-path="docs/handout.pdf"]');
    await page.waitForSelector('#file-view .pdf-page canvas');
    assert.equal(await page.$eval('#file-view .pdf-page-input', (n) => n.value), '2');
    assert.equal(await text(page, '#file-view .pdf-fit'), zoom);
  },
  { views: { 'docs/handout.pdf': PDF } },
);

uiTest(
  'pictures open in a tab, fitted, and an SVG is drawn as a picture that runs nothing and loads nothing',
  async (page) => {
    const requests = [];
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (!/^(file|data):/.test(request.url())) requests.push(request.url());
      request.continue();
    });
    await openInTree(page, 'figures/plot.png');
    await page.waitForSelector('#file-view .image-frame img');
    assert.equal(await text(page, '#file-view .image-caption'), '48 × 32');
    assert.equal(await page.$eval('#file-view .image-frame', (n) => n.classList.contains('fit')), true);
    await page.click('#file-view .image-frame');
    assert.equal(await page.$eval('#file-view .image-frame', (n) => n.getAttribute('aria-pressed')), 'true', 'actual size after a click');

    await page.click('#tree .node[data-path="figures/diagram.svg"]');
    await page.waitForFunction(() => document.querySelector('#file-view .image-caption')?.textContent === '40 × 20');
    assert.match(await page.$eval('#file-view img', (n) => n.src), /^data:image\/svg\+xml;base64,/);
    await sleep(300);
    assert.deepEqual(requests, [], 'its script did not run and its picture was not fetched');
    assert.equal(await count(page, '#tabs .tab'), 2);
  },
  {
    views: { 'figures/plot.png': { png: true } },
    files: {
      'figures/diagram.svg':
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><script>fetch("https://example.com/svg-script-ran")</script><rect width="40" height="20" fill="teal"/><image href="https://example.com/x.png"/></svg>',
    },
  },
);

uiTest(
  'a file the viewer cannot show says so calmly, with Reveal in Finder',
  async (page) => {
    await openInTree(page, 'data/scan.pdf');
    await page.waitForSelector('#file-view .viewer-problem');
    assert.match(await text(page, '#file-view .viewer-problem'), /Longhand cannot show this file.*scan\.pdf is 1\.2 GB, too large to show here/);
    await page.click('#file-view .viewer-problem button');
    assert.deepEqual(await page.evaluate(() => window.__revealed), ['data/scan.pdf']);

    await page.click('#tree .node[data-path="data/broken.pdf"]');
    await page.waitForFunction(() => /broken\.pdf looks damaged/.test(document.querySelector('#file-view .viewer-problem')?.textContent));
    await page.click('#tree .node[data-path="data/broken.png"]');
    await page.waitForFunction(() => /broken\.png looks damaged/.test(document.querySelector('#file-view .viewer-problem')?.textContent));
  },
  {
    views: {
      'data/scan.pdf': { error: { code: 'tooLarge', message: 'This file is too large to show.', size: 1_200_000_000 } },
      'data/broken.pdf': { bytes: 'this is not a PDF at all' },
      'data/broken.png': { bytes: 'nor a picture' },
    },
  },
);

uiTest(
  'a binary file and a pipe get a notice with Reveal in Finder, never garbage',
  async (page) => {
    await openInTree(page, 'data/weights.bin');
    await page.waitForSelector('.editor-notice:not([hidden])');
    assert.match(await text(page, '.editor-notice'), /weights\.bin is not a text file/);
    await page.click('.editor-notice .notice-actions button:first-child');
    assert.deepEqual(await page.evaluate(() => window.__revealed), ['data/weights.bin']);
    await page.click('#tree .node[data-path="data/fifo"]');
    await page.waitForFunction(() => /fifo is not a regular file/.test(document.querySelector('.editor-notice').textContent));
  },
  {
    files: { 'data/weights.bin': '', 'data/fifo': '' },
    disk: { 'data/weights.bin': { kind: 'binary', size: 5_000_000 }, 'data/fifo': { kind: 'notFile', size: 0 } },
  },
);

uiTest(
  'PDF tabs come back when the folder is reopened',
  async (page) => {
    await openInTree(page, 'docs/handout.pdf');
    await page.waitForSelector('#file-view .pdf-page canvas');
    await sleep(500);
    await reopenFolder(page);
    await page.waitForSelector('#file-view .pdf-page canvas');
    assert.equal(await text(page, '#tabs .tab.active .tab-name'), 'handout.pdf');
  },
  { views: { 'docs/handout.pdf': PDF } },
);

// ---- Markdown ----

const HOSTILE = `# Notes

<script>window.__pwned = 'script'</script>
<img src="x" onerror="window.__pwned = 'onerror'">
<img src="https://tracker.example.com/pixel.png" alt="Tracker">
<iframe src="https://example.com"></iframe>
<form action="https://example.com"><input name="q"><button>Send</button></form>
<div id="input" name="tutor">Shadow of the question box</div>
<div class="sheet-backdrop"><div class="sheet">A fake sheet over the whole window</div></div>
<a href="https://example.com/x" target="_blank" style="position:fixed;inset:0">Overlay</a>
<svg><script>window.__pwned = 'svg'</script></svg>
<math><mi xlink:href="javascript:window.__pwned='math'">x</mi></math>
<style>body { display: none }</style>
<table background="https://example.com/table.png"><tr><td background="https://example.com/cell.png">cell</td></tr></table>
<img src="figures/plot.png" usemap="#m"><map name="m"><area shape="default" href="https://example.com/area"></map>

[Click me](javascript:window.__pwned='link')
[Data](data:text/html,<script>alert(1)</script>)
[Elsewhere](../../outside.txt)
[Bad escape](%E0%A4%A)
[Bad anchor](#50%)
![Bad picture](%E0%A4%A.png)

- [x] done
- [ ] to do
`;

uiTest(
  'hostile Markdown runs no script, loads nothing remote, cannot navigate and cannot dress up as the app',
  async (page) => {
    const requests = [];
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      if (!/^(file|data):/.test(request.url())) requests.push(request.url());
      request.continue();
    });
    let navigations = 0;
    page.on('framenavigated', (frame) => frame === page.mainFrame() && navigations++);
    await page.waitForSelector('.notice');
    await page.click('.notice button.button.small');
    await page.waitForSelector('#handout .md-doc h1');
    await sleep(300);
    assert.equal(await page.evaluate(() => window.__pwned), undefined, 'no script ran');
    const doc = '#handout .md-doc';
    const tags = ['script', 'iframe', 'form', 'input', 'button', 'style', 'svg', 'map', 'area'];
    assert.equal(await count(page, tags.map((tag) => `${doc} ${tag}`).join(', ')), 0);
    assert.equal(await count(page, '#input'), 1, 'only the real question box has that id');
    const attributes = ['id', 'name', 'style', 'href', 'target', 'background', 'usemap'];
    assert.equal(await count(page, attributes.map((name) => `${doc} [${name}]`).join(', ')), 0);
    assert.equal(await count(page, `${doc} [src]:not(img[src^="data:image/png"])`), 0, 'only the folder picture loads');
    assert.equal(await count(page, `${doc} [class]:not(.md-image-missing, .md-image-missing *, a.inert)`), 0, 'no classes from the document');

    // The fake sheet is only text inside the document's box, not over the editor or the tutor.
    assert.equal(await count(page, '.sheet-backdrop'), 0);
    const covering = await page.evaluate(() => {
      const editor = document.querySelector('#editor').getBoundingClientRect();
      return document.elementFromPoint(editor.x + editor.width / 2, editor.y + editor.height / 2)?.closest('#handout') !== null;
    });
    assert.equal(covering, false);
    assert.equal(await page.$eval(doc, (n) => getComputedStyle(n).contain), 'layout paint');

    assert.match(await text(page, doc), /Tracker \(image from the web, not loaded\)/);
    assert.match(await text(page, doc), /Bad picture \(image not found in this folder\)/, 'a malformed escape blanks nothing');
    assert.match(await text(page, doc), /☑ done\s*☐ to do/, 'task boxes are shown as glyphs');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).display), 'flex', 'no stylesheet from the document');

    const inert = await page.$$eval(`${doc} a.inert`, (links) => links.map((a) => a.textContent));
    assert.deepEqual(inert, ['Click me', 'Data', 'Elsewhere', 'Bad escape', 'Bad anchor']);
    for (const link of await page.$$(`${doc} a`)) await link.click();
    await sleep(200);
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    assert.equal(navigations, 0, 'the window did not navigate');
    assert.deepEqual(await page.evaluate(() => window.__external), ['https://example.com/x'], 'web links open in the browser, not the window');
    assert.deepEqual(requests, [], 'nothing left the page');
  },
  { files: { 'handout.md': HOSTILE }, views: { 'figures/plot.png': { png: true } } },
);

const LINKED = `# Assignment

See [Grading](#grading) and the [starter code](stats/running.py), and [the tests](./tests/test_running.py#L4).

![Plot](figures/plot.png)

![Missing](figures/none.png)

$$\\mu_n = \\frac{1}{n}\\sum_i x_i$$

\`\`\`python
def mean(xs):
    return sum(xs) / len(xs)
\`\`\`

${'Filler paragraph.\n\n'.repeat(80)}
## Grading

Points.
`;

uiTest(
  'Markdown links scroll, open files in Longhand, and pictures, math and code are drawn',
  async (page) => {
    await menu(page, 'toggle-handout');
    const doc = '#handout .md-doc';
    await page.waitForSelector(`${doc} img[src^="data:image/png"]`);
    await page.waitForSelector(`${doc} .md-image-missing`);
    assert.match(await text(page, doc), /Missing \(image not found in this folder\)/);
    assert.ok(await count(page, `${doc} .katex`), 'math is drawn');
    assert.ok(await count(page, `${doc} pre .code-keyword`), 'Python is coloured');

    await page.click(`${doc} a[data-tip="Open stats/running.py"]`);
    await page.waitForFunction(() => document.querySelector('#status-file')?.textContent === 'stats/running.py');
    await page.click(`${doc} a[data-tip="Open tests/test_running.py"]`);
    await page.waitForFunction(() => document.querySelector('#status-file')?.textContent === 'tests/test_running.py');

    const scroller = '#handout .md-scroll';
    assert.equal(await page.$eval(scroller, (n) => n.scrollTop), 0);
    await page.click(`${doc} a`);
    await page.waitForFunction((s) => document.querySelector(s).scrollTop > 500, {}, scroller);
  },
  { files: { 'HANDOUT.md': LINKED }, views: { 'figures/plot.png': { png: true } } },
);

// ---- the handout pane ----

uiTest(
  'a named handout is offered once, quietly, and the pane opens only when asked',
  async (page) => {
    await page.waitForSelector('.notice');
    assert.match(await text(page, '.notice'), /handout\.pdf looks like this assignment's handout/);
    assert.equal(await isHidden(page, '#handout'), true, 'the pane does not open by itself');
    await page.click('.notice button.button.small');
    await page.waitForSelector('#handout .pdf-page canvas');
    assert.equal(await text(page, '#handout .handout-name'), 'handout.pdf');
    assert.equal(await count(page, '.notice'), 0);
    assert.equal(await page.$eval('#toggle-handout-panel', (n) => n.getAttribute('aria-pressed')), 'true');

    assert.equal(await count(page, '#handout .pane-head button'), 0, 'the title bar and the View menu show and hide it');
    await page.click('#toggle-handout-panel');
    assert.equal(await isHidden(page, '#handout'), true);
    await reopenFolder(page);
    assert.equal(await count(page, '.notice'), 0, 'not offered again');
  },
  { views: { 'handout.pdf': PDF } },
);

uiTest('the pane falls back to the README, and says how to choose a handout when there is none', async (page) => {
  assert.equal(await count(page, '.notice'), 0, 'a README is not offered');
  await page.click('#toggle-handout-panel');
  await page.waitForSelector('#handout .md-doc h1');
  assert.equal(await text(page, '#handout .handout-name'), 'README.md');
  await page.evaluate(() => delete window.__files['README.md']);
  await reopenFolder(page, '/demo/other');
  await menu(page, 'toggle-handout');
  await page.waitForSelector('#handout .empty-state');
  assert.match(await text(page, '#handout .empty-state'), /No handout.*Open as Handout/);
});

uiTest(
  'any PDF or Markdown file can be chosen as the handout, and the choice, width and page are kept per folder',
  async (page) => {
    await page.setViewport({ width: 1920, height: 1080 });
    await page.click('#tree .node[data-path="docs"]');
    await page.click('#tree .node[data-path="docs/spec.pdf"]', { button: 'right' });
    await page.$$eval('.ctx-item', (items) => items.find((n) => n.textContent === 'Open as Handout').click());
    await page.waitForSelector('#handout .pdf-page canvas');
    assert.equal(await text(page, '#handout .handout-name'), 'spec.pdf');
    await page.click('#handout [aria-label="Next page"]');
    await page.focus('.split-v[data-target="handout"]');
    await page.keyboard.press('ArrowLeft');
    const width = await page.$eval('#handout', (n) => n.offsetWidth);
    assert.equal(width, 436);
    await sleep(400);

    await reopenFolder(page, '/demo/other');
    assert.equal(await isHidden(page, '#handout'), true, 'another folder has its own handout');
    await reopenFolder(page);
    await page.waitForSelector('#handout .pdf-page canvas');
    assert.equal(await text(page, '#handout .handout-name'), 'spec.pdf');
    assert.equal(await page.$eval('#handout', (n) => n.offsetWidth), width);
    assert.equal(await page.$eval('#handout .pdf-page-input', (n) => n.value), '2');
  },
  { views: { 'docs/spec.pdf': PDF } },
);

uiTest(
  'a handout that was deleted says so in the pane',
  async (page) => {
    await page.waitForSelector('.notice');
    await page.click('.notice button.button.small');
    await page.waitForSelector('#handout .pdf-page canvas');
    await page.evaluate(() => window.__changeOnDisk('handout.pdf', null));
    await watcherSays(page, ['handout.pdf']);
    await page.waitForSelector('#handout .viewer-problem');
    assert.match(await text(page, '#handout .viewer-problem'), /handout\.pdf is no longer in this folder/);
    assert.equal(await count(page, '#handout .viewer-problem button'), 0, 'nothing to reveal');
  },
  { views: { 'handout.pdf': PDF } },
);

uiTest(
  'a handout follows its file: a new version is shown, and a rename keeps it chosen',
  async (page) => {
    await page.click('#tree .node[data-path="docs"]');
    await page.click('#tree .node[data-path="docs/spec.pdf"]', { button: 'right' });
    await page.$$eval('.ctx-item', (items) => items.find((n) => n.textContent === 'Open as Handout').click());
    await page.waitForFunction(() => document.querySelector('#handout .textLayer')?.textContent === 'Version one');
    await page.evaluate(() => {
      window.__mock.options.views['docs/spec.pdf'] = { pdf: ['Version two'] };
      window.__changeOnDisk('docs/spec.pdf', 'v2');
    });
    await watcherSays(page, ['docs/spec.pdf']);
    await page.waitForFunction(() => document.querySelector('#handout .textLayer')?.textContent === 'Version two');

    await page.click('#tree .node[data-path="docs/spec.pdf"]', { button: 'right' });
    await page.$$eval('.ctx-item', (items) => items.find((n) => n.querySelector('.ctx-label').textContent === 'Rename…').click());
    await page.$eval('#tree .new-name', (n) => (n.value = 'hw1.pdf'));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#handout .handout-name')?.textContent === 'hw1.pdf');
    await sleep(300);
    await reopenFolder(page);
    await page.waitForFunction(() => document.querySelector('#handout .handout-name')?.textContent === 'hw1.pdf');
    await page.waitForSelector('#handout .pdf-page canvas');
  },
  { views: { 'docs/spec.pdf': { pdf: ['Version one'] } } },
);

uiTest(
  'a PDF tab follows its file on disk, and becomes text when renamed to a text file',
  async (page) => {
    await openInTree(page, 'docs/notes.pdf');
    await page.waitForFunction(() => document.querySelector('#file-view .textLayer')?.textContent === 'First draft');
    await page.evaluate(() => {
      window.__mock.options.views['docs/notes.pdf'] = { pdf: ['Second draft'] };
      window.__changeOnDisk('docs/notes.pdf', 'Second draft as text');
    });
    await watcherSays(page, ['docs/notes.pdf']);
    await page.waitForFunction(() => document.querySelector('#file-view .textLayer')?.textContent === 'Second draft');

    await page.click('#tree .node[data-path="docs/notes.pdf"]', { button: 'right' });
    await page.$$eval('.ctx-item', (items) => items.find((n) => n.querySelector('.ctx-label').textContent === 'Rename…').click());
    await page.$eval('#tree .new-name', (n) => (n.value = 'notes.txt'));
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent === 'Second draft as text');
    assert.equal(await isHidden(page, '#file-view'), true);
    assert.equal(await text(page, '#tabs .tab.active span'), 'notes.txt');

    await openInTree(page, 'figures/plot.png');
    await page.waitForSelector('#file-view .image-frame img');
    await page.evaluate(() => window.__changeOnDisk('figures/plot.png', null));
    await watcherSays(page, ['figures/plot.png']);
    await page.waitForFunction(() => /plot\.png was deleted/.test(document.querySelector('.notice')?.textContent));
    assert.equal(await count(page, '#tabs .tab'), 1, 'its tab was closed, like a text file left unchanged');
  },
  { views: { 'docs/notes.pdf': { pdf: ['First draft'] }, 'figures/plot.png': { png: true } } },
);

uiTest('the handout is a side panel like the others: all fit at 1440 pixels, and the tutor folds first in a narrow window', async (page) => {
  await openInTree(page, 'stats/running.py');
  await menu(page, 'toggle-handout');
  await page.waitForSelector('#handout .md-doc');
  assert.deepEqual([await isHidden(page, '#files'), await isHidden(page, '#handout'), await isHidden(page, '#tutor')], [false, false, false]);
  assert.ok((await page.$eval('#editor', (n) => n.offsetWidth)) >= 360);
  assert.ok((await page.$eval('#handout', (n) => n.offsetWidth)) >= 300);

  await page.setViewport({ width: 1000, height: 800 });
  await page.waitForFunction(() => document.querySelector('#tutor').hidden);
  assert.equal(await isHidden(page, '#handout'), false);
  assert.ok((await page.$eval('#editor', (n) => n.offsetWidth)) >= 360);
  await page.setViewport({ width: 1920, height: 1080 });
  await page.waitForFunction(() => !document.querySelector('#tutor').hidden && !document.querySelector('#handout').hidden);
});
