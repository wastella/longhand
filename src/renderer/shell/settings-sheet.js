// The settings sheet (Longhand > Settings…, ⌘,): one row per registered setting.

import { h, spacer } from '../dom.js';
import { on } from '../state.js';
import { registerCommand, runCommand } from './commands.js';
import { getSetting, setSetting, settings } from './settings.js';
import { openSheet } from './sheet.js';

let version = '';

function control(setting) {
  const id = `setting-${setting.id}`;
  if (setting.type === 'toggle') {
    const input = h('input', { id, type: 'checkbox', class: 'switch', role: 'switch', checked: getSetting(setting.id) });
    input.onchange = () => setSetting(setting.id, input.checked);
    return input;
  }
  const select = h('select', { id }, ...setting.options.map((option) => h('option', { value: String(option.value) }, option.label)));
  select.value = String(getSetting(setting.id));
  // Option values may be numbers; the select only holds strings.
  select.onchange = () => setSetting(setting.id, setting.options.find((option) => String(option.value) === select.value).value);
  return select;
}

function row(setting) {
  return h(
    'div',
    { class: 'setting-row', 'data-setting': setting.id },
    h('div', { class: 'setting-text' }, h('label', { for: `setting-${setting.id}` }, setting.label), setting.description && h('p', {}, setting.description)),
    control(setting),
  );
}

function showSettings() {
  const list = h('div', { class: 'settings-list' }, ...[...settings.values()].map(row));
  // A setting changed elsewhere while the sheet is open (⌘= for text size) updates its row.
  const off = on('settings:changed', ({ id }) => {
    const old = list.querySelector(`[data-setting="${id}"]`);
    if (old && !old.contains(document.activeElement)) old.replaceWith(row(settings.get(id)));
  });
  const footer = [
    h('span', { id: 'app-version' }, version ? `Longhand ${version}` : 'Longhand'),
    spacer(),
    h('button', { class: 'button ghost small', onclick: () => runCommand('shortcuts') }, 'Keyboard Shortcuts'),
  ];
  openSheet({ title: 'Settings', body: list, footer, className: 'settings-sheet', onClose: off });
}

/** Records the app's version for the sheet's footer. */
export const setVersion = (value) => (version = value || '');

export function mountSettingsSheet() {
  registerCommand('settings', showSettings);
}
