// Moving keyboard focus between the main areas (View > Go to Files, Editor, Terminal, Tutor;
// ⌘1 to ⌘4). Each opens its panel if needed. An area can name the exact element to focus with
// registerFocusTarget; otherwise the first text field in the region, then its first control,
// then the region itself. The files panel goes straight to the region: its first control is the
// Find button, which is not where a student going to their files wants to land.

import { registerCommand } from './commands.js';
import { showBottomPane } from './bottom-panel.js';
import { showPanel } from './layout.js';

const targets = new Map();
const TEXT_ENTRY = 'textarea, input:not([type="hidden"]):not([type="checkbox"]), [contenteditable="true"]';
const CONTROL = 'button, select, [href], [tabindex]:not([tabindex="-1"])';

/**
 * Makes `getElement()` the element that View > Go to <area> focuses, where `area` is 'files',
 * 'editor', 'terminal' or 'tutor'. Return null to fall back to the default.
 */
export function registerFocusTarget(area, getElement) {
  targets.set(area, getElement);
}

const visible = (element) => element.offsetParent !== null && !element.disabled;
const first = (region, selector) => [...region.querySelectorAll(selector)].find(visible);

function focusArea(area, { textFirst, controls = true }) {
  const region = document.getElementById(area);
  let target = targets.get(area)?.() || (textFirst && first(region, TEXT_ENTRY)) || (controls && first(region, CONTROL));
  if (!target) {
    region.tabIndex = -1;
    target = region;
  }
  target.focus();
}

export function mountFocus() {
  registerCommand('focus-files', () => {
    showPanel('files');
    focusArea('files', { textFirst: false, controls: false });
  });
  // The editor region also holds the welcome screen, whose buttons take focus when no file is open.
  registerCommand('focus-editor', () => {
    const welcome = document.getElementById('welcome');
    const editing = document.getElementById('editor').querySelector('.cm-editor:not([hidden])');
    focusArea(!editing && welcome && visible(welcome) ? 'welcome' : 'editor', { textFirst: true });
  });
  registerCommand('focus-terminal', () => {
    showBottomPane('terminal');
    focusArea('terminal', { textFirst: true });
  });
  registerCommand('focus-tutor', () => {
    showPanel('tutor');
    focusArea('tutor', { textFirst: true });
  });
}
