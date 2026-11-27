// Opens the built interface (dist/) in headless Chrome, with tests/mock/ standing in for the
// Rust backend. Shared by the interface tests and the preview command.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const candidates = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export async function launch() {
  const executablePath = candidates.find((p) => existsSync(p));
  if (!executablePath) throw new Error('No Chrome or Chromium found. Set CHROME to the path of one.');
  return puppeteer.launch({ executablePath, headless: true, args: ['--allow-file-access-from-files', '--no-sandbox'] });
}

// core.js and fixture.js go first; each area's mock file then adds its own commands. Each file
// runs in its own scope, as if it were a separate script.
const mockDir = new URL('../tests/mock/', import.meta.url);
const first = ['core.js', 'fixture.js'];
const mockFiles = [
  ...first,
  ...readdirSync(mockDir)
    .filter((name) => name.endsWith('.js') && !first.includes(name))
    .sort(),
];
const mock = mockFiles.map((name) => `// ${name}\n(() => {\n${readFileSync(new URL(name, mockDir), 'utf8')}\n})();`).join('\n');

/**
 * Opens a page on the interface. `options` reach the mock as window.__MOCK__ (for example
 * { auth: { installed: false, loggedIn: false } }). Resolves once the file tree has loaded.
 */
export async function openApp(browser, options = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(`window.__MOCK__ = ${JSON.stringify(options)};\n${mock}`);
  await page.goto(pathToFileURL('dist/index.html').href);
  await page.waitForSelector('#tree .node');
  return { page, errors };
}

/** Opens a file through the file tree, expanding the folders on the way. */
export async function openFromTree(page, path) {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) await page.click(`#tree .node[data-path="${parts.slice(0, i).join('/')}"]`);
  await page.click(`#tree .node[data-path="${path}"]`);
  await page.waitForSelector('.cm-content');
}

/** Types a question into the tutor and waits for the answer to finish. */
export async function askTutor(page, question) {
  await page.type('#input', question);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('#send').hidden && document.querySelector('.msg.tutor'));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
