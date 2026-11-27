// The bottom panel: a row of tabs, each showing one pane (the terminal, the tests). Areas add
// their own pane with addBottomPane.

import { h, paneHead, spacer } from '../dom.js';
import { runCommand } from './commands.js';
import { icon } from './icons.js';
import { showPanel } from './layout.js';

const panes = new Map();
let root;
let head;
let gap;
let hideButton;

export function mountBottomPanel(region) {
  root = region;
  gap = spacer();
  hideButton = h(
    'button',
    {
      id: 'hide-bottom',
      class: 'button ghost icon-button small',
      'aria-label': 'Hide terminal and tests',
      'data-tip': 'Hide',
      'data-tip-command': 'toggle-bottom',
      onclick: () => runCommand('toggle-bottom'),
    },
    icon('x', 'small'),
  );
  head = paneHead(gap, hideButton);
  head.setAttribute('role', 'tablist');
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
  const tab = h(
    'button',
    { class: 'tab-btn' + (first ? ' active' : ''), role: 'tab', 'aria-selected': String(first), 'data-pane': name, onclick: () => showBottomPane(name) },
    label,
  );
  gap.before(tab);
  body.hidden = !first;
  root.append(body);
  if (actions) {
    actions.hidden = !first;
    hideButton.before(actions);
  }
  panes.set(name, { tab, body, actions, onShow });
}

/** Opens the bottom panel on the pane called `name`. */
export function showBottomPane(name) {
  if (!panes.has(name)) return;
  showPanel('bottom');
  for (const [paneName, pane] of panes) {
    const shown = paneName === name;
    pane.tab.classList.toggle('active', shown);
    pane.tab.setAttribute('aria-selected', String(shown));
    pane.body.hidden = !shown;
    if (pane.actions) pane.actions.hidden = !shown;
  }
  panes.get(name).onShow?.();
}
