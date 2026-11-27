// Noticing a server the student installs while Longhand is open, so nothing has to be restarted.
// Coming back to the window looks only where servers were last found. Asking the login shell
// again reads the student's whole profile, so that is kept for when an install is expected.

import { anyMissing, recheckMissing, timing } from './servers.js';

let watch = null;

/** The student was just handed an install command: keeps looking for a while, so the server is picked up when it lands. */
export function expectInstall() {
  clearInterval(watch);
  let left = timing.installChecks;
  watch = setInterval(() => {
    recheckMissing('fresh');
    left -= 1;
    if (left <= 0 || !anyMissing()) clearInterval(watch);
  }, timing.installCheck);
}

export function mountInstallWatch() {
  // Coming back to the window is when a server installed elsewhere would have appeared.
  window.addEventListener('focus', () => recheckMissing());
}
