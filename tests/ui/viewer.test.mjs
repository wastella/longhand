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
  'pictures open in a tab, fitted, and an SVG is drawn as a picture whose script never runs',
  async (page) => {
    await openInTree(page, 'figures/plot.png');
    await page.waitForSelector('#file-view .image-frame img');
    assert.equal(await text(page, '#file-view .image-caption'), '48 × 32');
    assert.equal(await page.$eval('#file-view .image-frame', (n) => n.classList.contains('fit')), true);
    await page.click('#file-view .image-frame');
    assert.equal(await page.$eval('#file-view .image-frame', (n) => n.getAttribute('aria-pressed')), 'true', 'actual size after a click');

    await page.click('#tree .node[data-path="figures/diagram.svg"]');
    await page.waitForFunction(() => document.querySelector('#file-view .image-caption')?.textContent === '40 × 20');
    assert.match(await page.$eval('#file-view img', (n) => n.src), /^data:image\/svg\+xml;base64,/);
    await sleep(200);
    assert.equal(await page.evaluate(() => window.__svgRan), undefined);
    assert.equal(await count(page, '#tabs .tab'), 2);
  },
  {
    views: { 'figures/plot.png': { png: true } },
    files: {
      'figures/diagram.svg':
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><script>parent.__svgRan = true; window.__svgRan = true</script><rect width="40" height="20" fill="teal"/><image href="https://example.com/x.png"/></svg>',
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

uiTest('a Markdown file opens as text, and Preview shows it rendered with its unsaved edits', async (page) => {
  await openInTree(page, 'README.md');
  await page.waitForSelector('.cm-content');
  assert.equal(await isHidden(page, '#tab-tools'), false);
  await page.click('.cm-line:last-child');
  await page.keyboard.type('\n## Added just now\n');
  await page.click('#markdown-preview');
  await page.waitForSelector('#file-view .md-doc h1');
  assert.equal(await text(page, '#file-view .md-doc h1'), 'Running statistics');
  assert.equal(await text(page, '#file-view .md-doc h2'), 'Added just now');
  assert.equal(await isHidden(page, '.cm-editor'), true);
  assert.equal(await page.$eval('#markdown-preview', (n) => n.getAttribute('aria-pressed')), 'true');
  await page.click('#markdown-preview');
  assert.equal(await isHidden(page, '.cm-editor'), false);
  assert.equal(await isHidden(page, '#file-view'), true);
  assert.equal(await count(page, '#tabs .tab.dirty'), 1, 'the edits are still there, unsaved');

  await page.click('#tree .node[data-path="pyproject.toml"]');
  await page.waitForFunction(() => document.querySelector('#tab-tools').hidden);
});

const HOSTILE = `# Notes

<script>window.__pwned = 'script'</script>
<img src="x" onerror="window.__pwned = 'onerror'">
<img src="https://tracker.example.com/pixel.png" alt="Tracker">
<iframe src="https://example.com"></iframe>
<form action="https://example.com"><input name="q"><button>Send</button></form>
<div id="input" name="tutor">Shadow of the question box</div>
<a href="https://example.com/x" target="_blank" style="position:fixed;inset:0">Overlay</a>
<svg><script>window.__pwned = 'svg'</script></svg>
<math><mi xlink:href="javascript:window.__pwned='math'">x</mi></math>
<style>body { display: none }</style>

[Click me](javascript:window.__pwned='link')
[Data](data:text/html,<script>alert(1)</script>)
[Elsewhere](../../outside.txt)
`;

uiTest(
  'hostile Markdown runs no script, loads nothing remote, cannot navigate and cannot shadow the app',
  async (page) => {
    await menu(page, 'toggle-handout');
    await page.waitForSelector('#handout .md-doc h1');
    await sleep(300);
    assert.equal(await page.evaluate(() => window.__pwned), undefined, 'no script ran');
    const doc = '#handout .md-doc';
    assert.equal(await count(page, `${doc} script, ${doc} iframe, ${doc} form, ${doc} input, ${doc} button, ${doc} style, ${doc} svg`), 0);
    assert.equal(await count(page, '#input'), 1, 'only the real question box has that id');
    assert.equal(await page.$$eval(`${doc} [id], ${doc} [name], ${doc} [style], ${doc} [href], ${doc} [target]`, (n) => n.length), 0);
    assert.deepEqual(await page.$$eval(`${doc} img`, (n) => n.map((img) => img.getAttribute('src'))), [], 'no picture points anywhere');
    assert.match(await text(page, doc), /Tracker \(image from the web, not loaded\)/);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).display), 'flex', 'no stylesheet from the document');

    const inert = await page.$$eval(`${doc} a.inert`, (links) => links.map((a) => a.textContent));
    assert.deepEqual(inert, ['Click me', 'Data', 'Elsewhere']);
    await page.click(`${doc} a.inert`);
    assert.equal(await page.evaluate(() => window.__pwned), undefined);
    const url = page.url();
    await page.click(`${doc} a:not(.inert)`);
    assert.equal(page.url(), url, 'the window did not navigate');
    assert.deepEqual(await page.evaluate(() => window.__external), ['https://example.com/x'], 'web links open in the browser');
  },
  { files: { 'handout.md': HOSTILE } },
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

    await page.click('#handout .pane-head [aria-label="Hide the handout"]');
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
  'a PDF tab can be moved beside the code with Open as Handout',
  async (page) => {
    await openInTree(page, 'docs/spec.pdf');
    await page.waitForSelector('#file-view .pdf-page canvas');
    await page.click('#open-as-handout');
    await page.waitForSelector('#handout .pdf-page canvas');
    assert.equal(await text(page, '#handout .handout-name'), 'spec.pdf');
  },
  { views: { 'docs/spec.pdf': PDF } },
);

uiTest(
  'a handout that was deleted says so in the pane',
  async (page) => {
    await page.waitForSelector('.notice');
    await page.click('.notice button.button.small');
    await page.waitForSelector('#handout .pdf-page canvas');
    await page.evaluate(() => {
      delete window.__files['handout.pdf'];
      window.__mock.options.views['handout.pdf'] = { error: { code: 'missing', message: 'gone' } };
    });
    await reopenFolder(page);
    await page.waitForSelector('#handout .viewer-problem');
    assert.match(await text(page, '#handout .viewer-problem'), /handout\.pdf is no longer in this folder/);
    assert.equal(await count(page, '#handout .viewer-problem button'), 0, 'nothing to reveal');
  },
  { views: { 'handout.pdf': PDF } },
);

uiTest('beside the handout at laptop width, the tutor folds so the code keeps its room, and comes back when asked', async (page) => {
  await page.setViewport({ width: 1280, height: 800 });
  await openInTree(page, 'stats/running.py');
  await menu(page, 'toggle-handout');
  await page.waitForSelector('#handout .md-doc');
  assert.equal(await isHidden(page, '#tutor'), true);
  assert.ok((await page.$eval('#editor', (n) => n.offsetWidth)) >= 480);
  await menu(page, 'toggle-tutor');
  assert.deepEqual([await isHidden(page, '#tutor'), await isHidden(page, '#handout')], [false, true], 'the panel asked for last stays');
  await page.setViewport({ width: 1920, height: 1080 });
  await page.waitForFunction(() => !document.querySelector('#tutor').hidden && !document.querySelector('#handout').hidden);
});
