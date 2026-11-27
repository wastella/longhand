// Opens the built interface in headless Chrome with scripts/mock-backend.js standing in
// for the Rust backend. Shared by the screenshot and interface-test scripts.
import { existsSync, readFileSync } from 'node:fs';
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

const mock = readFileSync(new URL('./mock-backend.js', import.meta.url), 'utf8');

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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
