// The bottom panel: a row of tabs, each showing one pane (the terminal, the tests). Areas add
// their own pane with addBottomPane.

import { h, paneHead, spacer } from '../dom.js';
import { showPanel } from './layout.js';

const panes = new Map();
let root;
let head;
let gap;

export function mountBottomPanel(region) {
  root = region;
  gap = spacer();
  head = paneHead(gap);
  root.append(head);
}

/**
 * Adds a pane. `label` is the tab's content (text or nodes), `body` the pane itself, `actions`
 * an optional element shown at the right of the tab row only while this pane is visible, and
 * `onShow` an optional function called when the pane is brought to the front.
 * The first pane added is the one shown at start.
 */
export function addBottomPane({ name, label, body, actions, onShow }) {
  const first = panes.size === 0;
  const tab = h('button', { class: 'tab-btn' + (first ? ' active' : ''), 'data-pane': name, onclick: () => showBottomPane(name) }, label);
  gap.before(tab);
  body.hidden = !first;
  root.append(body);
  if (actions) {
    actions.hidden = !first;
    head.append(actions);
  }
  panes.set(name, { tab, body, actions, onShow });
}

/** Opens the bottom panel on the pane called `name`. */
export function showBottomPane(name) {
  showPanel('bottom');
  for (const [paneName, pane] of panes) {
    const shown = paneName === name;
    pane.tab.classList.toggle('active', shown);
    pane.body.hidden = !shown;
    if (pane.actions) pane.actions.hidden = !shown;
  }
  panes.get(name).onShow?.();
}
