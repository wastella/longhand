// Panels another area attaches beneath a failing test's detail. Each failing test keeps its
// panel for as long as it keeps failing, across reruns, so whatever the panel holds (a
// conversation about that failure, say) is still there after the next run.
//
// The panel's code belongs to another area: whatever it throws is caught and logged here, so
// it can never break the test pane or stop a run's end from being announced.

import { failed } from './model.js';

let renderer = null;
/** Node id → { node, test }. */
const panels = new Map();
/** Node id → the node a disposed panel left in its place, shown while that test passes. */
const parting = new Map();

function guarded(what, fn, ...args) {
  try {
    return fn(...args);
  } catch (error) {
    console.error(`The failure panel's ${what} failed:`, error);
    return undefined;
  }
}

/**
 * Registers a failure panel:
 *   render(test)          returns a node to show beneath the failing test's detail, or null.
 *                         Called once per failing test, when it is first shown; the node is then
 *                         kept while the test keeps failing.
 *   dispose(test, node)   the test passed (or no longer fails), no longer exists after a
 *                         complete run, or the folder changed. Not called for a test that a
 *                         stopped or crashed run did not reach: that one keeps its panel.
 *                         When the test now passes it may return a node to show beneath it
 *                         instead, until it fails again (the node hides itself when done).
 *   update(test, node)    the test failed again, differently (a new message or traceback).
 * Returns a function that removes the panel and disposes its nodes; calling it again, or after
 * another panel was registered, does nothing.
 */
export function registerFailurePanel(render, dispose = () => {}, update = () => {}) {
  if (renderer) throw new Error('A failure panel is already registered');
  const mine = { render, dispose, update };
  renderer = mine;
  return () => {
    if (renderer !== mine) return;
    disposeAll();
    renderer = null;
  };
}

/**
 * The panel for a failing test, made on first use; for a passing test, what its panel left
 * behind, if anything; otherwise null.
 */
export function panelFor(test) {
  if (!renderer) return null;
  if (!failed(test)) return parting.get(test.id) || null;
  dropParting(test.id);
  if (!panels.has(test.id)) {
    const node = guarded('render', renderer.render, test);
    panels.set(test.id, { node: node instanceof Node ? node : null, test });
  }
  return panels.get(test.id).node;
}

const failure = (test) => [test.status, test.phase, test.message, test.detail].join('\n');

/**
 * Brings the panels up to date with the latest results, `tests` (which keep, marked out of
 * date, the results a stopped run did not reach). A panel goes when its test no longer fails,
 * or is no longer in the results at all, which happens only once a complete run showed it gone.
 * Returns true when a panel left a node behind, so the detail shown may need drawing again.
 */
export function prunePanels(tests) {
  const byId = new Map(tests.map((test) => [test.id, test]));
  let left = false;
  for (const id of [...parting.keys()]) if (!byId.has(id)) dropParting(id);
  for (const [id, panel] of panels) {
    const now = byId.get(id);
    if (!now || !failed(now)) {
      const node = release(id, now || panel.test);
      if (now && node instanceof Node) {
        parting.set(id, node);
        left = true;
      }
      continue;
    }
    if (now === panel.test) continue;
    const changed = failure(now) !== failure(panel.test);
    panel.test = now;
    if (changed && panel.node && renderer) guarded('update', renderer.update, now, panel.node);
  }
  return left;
}

export function disposeAll() {
  for (const [id, panel] of panels) release(id, panel.test);
  for (const id of [...parting.keys()]) dropParting(id);
}

/**
 * Lets go of what a disposed panel left behind. The node is sent a `panel-removed` event, so
 * whatever it is still doing (an answer streaming in) can stop.
 */
function dropParting(id) {
  const node = parting.get(id);
  if (!node) return;
  parting.delete(id);
  node.remove();
  node.dispatchEvent(new Event('panel-removed'));
}

/** Removes a test's panel; returns what dispose left in its place. */
function release(id, test) {
  const { node } = panels.get(id);
  panels.delete(id);
  node?.remove();
  return node && renderer ? guarded('dispose', renderer.dispose, test, node) : undefined;
}
