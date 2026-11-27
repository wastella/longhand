// Asking before any language server runs. A server runs the folder's code, so a folder the
// student has just downloaded gets none until they turn code checking on for it. The asking is
// quiet: one notification, never a dialog on opening. File > Code Checking for This Folder…
// opens the same sheet later, and says there when a server is not installed.

import { h, spacer } from '../dom.js';
import { state } from '../state.js';
import { notify, openSheet } from '../shell/index.js';
import { KINDS } from './kinds.js';
import { checking, hasCheckableFiles, isEnabled, serverOf, setChecking } from './servers.js';
import { showServerSheet } from './status.js';

/** A line for each server that is needed but not installed, leading to how to install it. */
function missingServers(close) {
  return Object.keys(KINDS)
    .filter((kind) => serverOf(kind)?.status === 'missing')
    .map((kind) =>
      h(
        'p',
        { class: 'language-note' },
        `No ${KINDS[kind].label} language server is installed, so errors are not underlined yet. `,
        h('button', { class: 'button small', type: 'button', onclick: () => (close(), showServerSheet(kind)) }, 'How to Install…'),
      ),
    );
}

/** Whether this folder's notification has been shown, so it is shown once. */
let mentioned = false;

/** The sheet that turns code checking on or off for the open folder. */
export function showCheckingSheet() {
  if (!state.workspace || checking() === undefined) return;
  const on = checking() === 'on';
  let sheet;
  const decide = (value) => () => {
    sheet.close();
    setChecking(value);
  };
  const button = (label, run, primary) => h('button', { class: primary ? 'button primary' : 'button', type: 'button', onclick: run }, label);
  const tools = 'runs language tools on this folder, including the folder’s own Python environment';
  const body = on
    ? [h('p', {}, `Code checking is on for this folder: Longhand underlines errors as you type, which ${tools}.`), ...missingServers(() => sheet.close())]
    : [
        h('p', {}, `Checking code as you type ${tools}. Only turn it on for folders you trust.`),
        h('p', { class: 'language-note' }, 'With it on, Longhand underlines errors, shows documentation and can take you to where a name is defined.'),
      ];
  const footer = on
    ? [spacer(), button('Turn Off', decide(false)), button('Keep On', () => sheet.close(), true)]
    : [spacer(), button('Keep Off', decide(false)), button('Turn On', decide(true), true)];
  sheet = openSheet({ title: 'Code checking', body, footer, className: 'language-sheet checking-sheet' });
}

/** Mentions once, when the first file a server could check is open, that checking is off until the student says otherwise. */
export function mentionChecking() {
  if (checking() === undefined) mentioned = false;
  if (mentioned || checking() !== null || !isEnabled() || !hasCheckableFiles()) return;
  mentioned = true;
  notify({
    message: 'Code checking is off for this folder, so errors are not underlined.',
    action: { label: 'Turn On…', run: showCheckingSheet },
  });
}
