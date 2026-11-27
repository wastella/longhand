// A failing test with a panel attached through registerFailurePanel (tests/index.js), as the
// tutor will attach its help. No area registers one yet, so this builds the interface with a
// stand-in that does, and reloads the page on it.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const description = 'A failing test with a panel attached beneath it (the hook for help pinned to a failure)';

const entry = `
import '../src/renderer/main.js';
import { latestResults, registerFailurePanel } from '../src/renderer/tests/index.js';
import { on } from '../src/renderer/state.js';

const log = (window.__panels = { made: [], disposed: [], updated: [], selected: [] });
window.__latestResults = latestResults;
window.__registerFailurePanel = registerFailurePanel;
window.__on = on;
on('tests:selected', (test) => log.selected.push(test ? test.id : null));
window.__unregisterPanel = registerFailurePanel(
  (test) => {
    log.made.push(test.id);
    const node = document.createElement('div');
    node.className = 'dummy-panel';
    node.innerHTML = '<p class="dim">Pinned to <code></code></p><textarea class="text-input" rows="2" style="width: 100%; padding: 6px"placeholder="Notes on this failure"></textarea>';
    node.querySelector('code').textContent = test.id;
    return node;
  },
  (test, node) => log.disposed.push([test.id, node.className]),
  (test, node) => log.updated.push([test.id, test.status, node.className]),
);
`;

/** Reloads `page` on an interface that has a stand-in failure panel registered. */
export async function withDummyPanel(page) {
  await build({ stdin: { contents: entry, resolveDir: 'dist' }, bundle: true, outfile: 'dist/failure-panel.js', format: 'iife', logLevel: 'warning' });
  writeFileSync('dist/failure-panel.html', readFileSync('dist/index.html', 'utf8').replace('renderer.js', 'failure-panel.js'));
  await page.goto(pathToFileURL('dist/failure-panel.html').href);
  await page.waitForSelector('#tree .node');
}

export default async function (page) {
  await withDummyPanel(page);
  await page.evaluate(() => (document.getElementById('bottom').style.height = '400px'));
  await page.evaluate(() => window.__emit('menu', 'run-tests'));
  await page.waitForSelector('.tests-failure-panel .dummy-panel');
  await page.type('.dummy-panel textarea', 'Expected 4.0: the mean moves after each push.');
}
