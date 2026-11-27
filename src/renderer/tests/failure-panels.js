// Panels another area attaches beneath a failing test's detail. Each failing test keeps its
// panel for as long as it keeps failing, across reruns, so whatever the panel holds (a
// conversation about that failure, say) is still there after the next run.

import { failed } from './model.js';

let renderer = null;
/** Node id → { node, dispose }. */
const panels = new Map();

/**
 * Registers `render(test)`, which returns a node to show beneath the failing test's detail, or
 * null for none. It is called once per failing test, when the test is first shown; the node is
 * then reused while the test keeps failing. `dispose(test, node)` is called when the test
 * passes, disappears from the results, or the folder changes. Returns a function that removes
 * the renderer (disposing its panels).
 */
export function registerFailurePanel(render, dispose = () => {}) {
  if (renderer) throw new Error('A failure panel is already registered');
  renderer = { render, dispose };
  return () => {
    disposeAll();
    renderer = null;
  };
}

/** The panel for a failing test, made on first use; null for tests that are not failing. */
export function panelFor(test) {
  if (!renderer || !failed(test)) return null;
  if (!panels.has(test.id)) {
    const node = renderer.render(test) || null;
    panels.set(test.id, { node, test, dispose: renderer.dispose });
  }
  return panels.get(test.id).node;
}

/** Drops the panels of tests that no longer fail, now that `tests` are the latest results. */
export function prunePanels(tests) {
  const byId = new Map(tests.map((test) => [test.id, test]));
  for (const [id, panel] of panels) {
    const now = byId.get(id);
    if (now && failed(now)) panel.test = now;
    else release(id, now || panel.test);
  }
}

export function disposeAll() {
  for (const [id, panel] of panels) release(id, panel.test);
}

function release(id, test) {
  const { node, dispose } = panels.get(id);
  panels.delete(id);
  node?.remove();
  if (node) dispose(test, node);
}
