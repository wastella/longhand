// The welcome screen, shown over the editor whenever no file is open.

import { invoke } from '../backend.js';
import { h } from '../dom.js';
import { on } from '../state.js';

const intro = h('p', {}, 'You write the code. The tutor reads along and answers like a TA in office hours.');
const openFolder = h('button', { id: 'open-folder', class: 'primary', onclick: () => invoke('workspace_choose') }, 'Open a folder');
const lastFolder = h('p', { id: 'welcome-last', class: 'dim' });

/** Offers a button to reopen the folder used last time. */
export function offerLastWorkspace(dir) {
  const reopen = h('button', { class: 'ghost', onclick: () => invoke('workspace_open', { dir }) }, `Reopen ${dir.split('/').pop()}`);
  lastFolder.replaceChildren(reopen);
}

export function mountWelcome(region) {
  region.append(h('h1', {}, 'Longhand'), intro, openFolder, lastFolder);
  on('workspace:opened', () => {
    intro.textContent = 'Pick a file on the left to start writing.';
    openFolder.hidden = true;
    lastFolder.hidden = true;
  });
  on('editor:active', (path) => (region.hidden = Boolean(path)));
}
