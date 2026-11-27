// App-wide settings, saved by the backend in the app data directory (prefs.rs). Any area can add
// one with registerSetting; the settings sheet (settings-sheet.js) lists them all.

import { invoke } from '../backend.js';
import { emit } from '../state.js';
import { notify } from './notify.js';

/** id -> { id, label, description, type, options, default }, in the order registered. */
export const settings = new Map();
/** The saved values, as the backend last returned them. */
let saved = {};

function isValid(setting, value) {
  if (setting.type === 'toggle') return typeof value === 'boolean';
  return setting.options.some((option) => option.value === value);
}

/**
 * Adds a setting to the settings sheet. `type` is 'choice' (pick one of `options`, each
 * { value, label }) or 'toggle' (on or off). `default` is used until the student changes it.
 * Register while mounting; the saved value is announced with settings:changed once settings load.
 *
 *   registerSetting({ id: 'language.servers', label: 'Check code as I type', type: 'toggle', default: true })
 */
export function registerSetting({ id, label, description, type, options, default: fallback }) {
  if (settings.has(id)) throw new Error(`Setting "${id}" is already registered`);
  if (type !== 'choice' && type !== 'toggle') throw new Error(`Setting "${id}" needs type 'choice' or 'toggle'`);
  if (type === 'choice' && !options?.length) throw new Error(`Setting "${id}" needs options`);
  const setting = { id, label, description, type, options, default: fallback };
  if (!isValid(setting, fallback)) throw new Error(`Setting "${id}" has a default that is not one of its values`);
  settings.set(id, setting);
}

/** The current value of setting `id`: the saved one if it is still valid, else the default. */
export function getSetting(id) {
  const setting = settings.get(id);
  if (!setting) throw new Error(`No setting called "${id}"`);
  return isValid(setting, saved[id]) ? saved[id] : setting.default;
}

/** Changes setting `id`, announces it with settings:changed, and saves it. */
export async function setSetting(id, value) {
  const setting = settings.get(id);
  if (!setting) throw new Error(`No setting called "${id}"`);
  if (!isValid(setting, value)) throw new Error(`"${value}" is not a value of setting "${id}"`);
  if (getSetting(id) === value) return;
  saved = { ...saved, [id]: value };
  await emit('settings:changed', { id, value });
  try {
    await invoke('settings_set', { patch: { [id]: value } });
  } catch (error) {
    notify({ kind: 'error', message: `The setting is applied but could not be saved for next time: ${error}` });
  }
}

/** Takes the saved values from start-up and announces every setting's value once. */
export async function applySavedSettings(values) {
  saved = values || {};
  for (const id of settings.keys()) await emit('settings:changed', { id, value: getSetting(id) });
}
