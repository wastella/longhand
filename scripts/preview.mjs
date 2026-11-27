// Renders the interface in headless Chrome against the mock backend and saves a screenshot.
//
//   npm run preview -- --out shot.png [--scenario failing-test] [--theme light]
//   npm run preview -- --list
//
// --theme dark or light sets the app's Appearance setting; without it the scenario decides (the
// default follows the system, which headless Chrome reports as light).
//
// A scenario is a file in scripts/scenarios/ (see README there): its name is the file name.
import { mkdirSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { launch, openApp, sleep } from './browser.mjs';

const scenarioDir = new URL('./scenarios/', import.meta.url);
const scenarios = readdirSync(scenarioDir)
  .filter((name) => name.endsWith('.mjs'))
  .map((name) => name.slice(0, -'.mjs'.length))
  .sort();

const { values } = parseArgs({
  options: { out: { type: 'string' }, scenario: { type: 'string', default: 'default' }, theme: { type: 'string' }, list: { type: 'boolean' } },
});

if (values.list) {
  for (const name of scenarios) console.log(`${name.padEnd(22)}${(await import(new URL(`${name}.mjs`, scenarioDir))).description}`);
  process.exit(0);
}
if (!values.out) {
  console.error('Usage: npm run preview -- --out <file.png> [--scenario <name>]   (--list shows the scenarios)');
  process.exit(2);
}
if (!scenarios.includes(values.scenario)) {
  console.error(`Unknown scenario "${values.scenario}". Known: ${scenarios.join(', ')}`);
  process.exit(2);
}

if (values.theme && !['dark', 'light'].includes(values.theme)) {
  console.error('--theme is dark or light');
  process.exit(2);
}

const scenario = await import(new URL(`${values.scenario}.mjs`, scenarioDir));
let options = scenario.options;
if (values.theme) {
  const init = options?.init || {};
  options = { ...options, init: { ...init, settings: { ...init.settings, theme: values.theme } } };
}
const browser = await launch();
try {
  const { page, errors } = await openApp(browser, options);
  await scenario.default(page);
  // Let animation frames and the terminal settle before the picture.
  await sleep(500);
  mkdirSync(dirname(values.out), { recursive: true });
  await page.screenshot({ path: values.out });
  if (errors.length) console.warn(`The page reported errors:\n  ${errors.join('\n  ')}`);
  console.log(`wrote ${values.out} (${values.scenario})`);
} finally {
  await browser.close();
}
