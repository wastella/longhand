// The app shell: layout, panels, title bar, status bar, welcome screen, text size and the
// command registry. Other areas import from this file only.

import { mountBottomPanel } from './bottom-panel.js';
import { mountLayout } from './layout.js';
import { mountStatusBar } from './status-bar.js';
import { mountTextSize } from './text-size.js';
import { mountTitleBar } from './title-bar.js';
import { mountWelcome } from './welcome.js';
import { mountLeaveGuards } from './leave-guards.js';

export { registerCommand, runCommand } from './commands.js';
export { showPanel } from './layout.js';
export { addBottomPane, showBottomPane } from './bottom-panel.js';
export { showStatus } from './status-bar.js';
export { applySavedTextSize } from './text-size.js';
export { offerLastWorkspace } from './welcome.js';
export { confirmLeave, registerLeaveGuard } from './leave-guards.js';

export function mount({ titleBar, welcome, bottom, status }) {
  mountLayout();
  mountTextSize();
  mountTitleBar(titleBar);
  mountWelcome(welcome);
  mountBottomPanel(bottom);
  mountStatusBar(status);
  mountLeaveGuards();
}
