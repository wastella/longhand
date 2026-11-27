// The colour theme: dark, light, or matching the system. The theme is a data-theme attribute on
// <html> that switches the colour tokens (tokens.css); code that copies token values (the editor,
// the terminal) re-reads them on theme:changed.

import { invoke } from '../backend.js';
import { emit, on } from '../state.js';
import { getSetting, registerSetting } from './settings.js';

const systemLight = window.matchMedia('(prefers-color-scheme: light)');
// The last theme shown, so the next launch starts in it instead of flashing dark first.
const CACHE_KEY = 'theme';

/** The theme on screen: 'dark' or 'light'. */
export const currentTheme = () => document.documentElement.dataset.theme;

function show(theme) {
  if (currentTheme() === theme) return;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(CACHE_KEY, theme);
  } catch {
    // Only a convenience for the next launch.
  }
  emit('theme:changed', theme);
}

function apply() {
  const choice = getSetting('theme');
  show(choice === 'system' ? (systemLight.matches ? 'light' : 'dark') : choice);
  // The window's own parts (its buttons, native dialogs) follow too. Not fatal if it fails.
  invoke('window_set_theme', { theme: choice }).catch(() => {});
}

export function mountTheme() {
  let cached = null;
  try {
    cached = localStorage.getItem(CACHE_KEY);
  } catch {
    // Start in dark, the default.
  }
  document.documentElement.dataset.theme = cached === 'light' ? 'light' : 'dark';

  registerSetting({
    id: 'theme',
    label: 'Appearance',
    type: 'choice',
    options: [
      { value: 'system', label: 'Match System' },
      { value: 'dark', label: 'Dark' },
      { value: 'light', label: 'Light' },
    ],
    default: 'system',
  });
  on('settings:changed', ({ id }) => id === 'theme' && apply());
  systemLight.addEventListener('change', () => getSetting('theme') === 'system' && apply());
}
