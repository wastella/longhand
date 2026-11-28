// The app shell: layout, panels, title and status bars, welcome screen, folders, settings, themes,
// notifications and the shared components. Other areas import from this file only.

import { mountBottomPanel } from './bottom-panel.js';
import { mountFocus } from './focus.js';
import { folderPending, mountFolders, openFolder, refreshRecents, setRecents } from './folders.js';
import { mountLayout, restoreLayout } from './layout.js';
import { mountLeaveGuards } from './leave-guards.js';
import { mountNotices } from './notify.js';
import { applySavedSettings } from './settings.js';
import { mountSettingsSheet, setVersion } from './settings-sheet.js';
import { loadShortcuts, mountShortcuts } from './shortcuts.js';
import { mountStatusBar } from './status-bar.js';
import { mountTextSize } from './text-size.js';
import { mountTheme } from './theme.js';
import { mountTitleBar } from './title-bar.js';
import { mountTooltips } from './tooltip.js';
import { mountWelcome, renderWelcome } from './welcome.js';

export { registerCommand, runCommand } from './commands.js';
export { showPanel, hidePanel, setPanel, isPanelShown } from './layout.js';
export { addBottomPane, showBottomPane } from './bottom-panel.js';
export { addStatusItem, showStatus } from './status-bar.js';
export { confirmLeave, registerLeaveGuard } from './leave-guards.js';
export { notify } from './notify.js';
export { registerSetting, getSetting, setSetting } from './settings.js';
export { currentTheme } from './theme.js';
export { registerFocusTarget } from './focus.js';
export { openSheet } from './sheet.js';
export { icon, iconNames } from './icons.js';
export { formatKeys, kbd } from './keys.js';
export { withKeys } from './shortcuts.js';
export { openFolder } from './folders.js';

export function mount({ titleBar, welcome, bottom, status }) {
  // Settings first, so the theme is on <html> before anything else draws.
  mountTheme();
  mountTextSize();
  mountNotices();
  mountTooltips();
  mountLayout();
  mountTitleBar(titleBar);
  mountFolders();
  mountWelcome(welcome);
  mountBottomPanel(bottom);
  mountStatusBar(status);
  mountLeaveGuards();
  mountFocus();
  mountSettingsSheet();
  mountShortcuts();
}

/**
 * Applies what app_init returned (saved settings, layout, recent folders, version) once every
 * area is mounted, so all of them hear the settings:changed that follow.
 */
export async function restore(init) {
  setVersion(init.version);
  restoreLayout(init.layout);
  setRecents(init.recents);
  await loadShortcuts();
  renderWelcome();
  await applySavedSettings(init.settings);
}

/**
 * Opens the folder given on the command line, else the one open last time, unless a folder was
 * already opened (dropped on the window during start-up). Then checks which recent folders still
 * exist, without holding anything up.
 */
export async function openFirstFolder(init) {
  if (!folderPending()) {
    if (init.openDir) await openFolder(init.openDir);
    else if (init.lastWorkspace) await openFolder(init.lastWorkspace, { quiet: true });
  }
  refreshRecents();
}
