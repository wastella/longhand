// Starts the interface: each area builds itself into its region of index.html, then the
// backend says which folder (if any) to open.

import { invoke, listen } from './backend.js';
import { emit, state } from './state.js';
import * as shell from './shell/index.js';
import * as editor from './editor/index.js';
import * as files from './files/index.js';
import * as terminal from './terminal/index.js';
import * as tests from './tests/index.js';
import * as tutor from './tutor/index.js';
import { runSmoke } from './smoke.js';

const region = (id) => document.getElementById(id);

async function openWorkspace(ws) {
  state.workspace = ws;
  state.config = ws.config;
  await emit('workspace:opened', ws);
  emit('workspace:ready');
}

async function main() {
  shell.mount({ titleBar: region('titlebar'), welcome: region('welcome'), bottom: region('bottom'), status: region('status') });
  editor.mount(region('editor'));
  files.mount(region('files'));
  // The terminal mounts before the tests so its tab comes first in the bottom panel.
  terminal.mount();
  tests.mount();
  tutor.mount(region('tutor'));
  shell.applySavedTextSize();

  listen('workspace:opened', openWorkspace);
  listen('menu', (id) => shell.runCommand(id));

  const init = await invoke('app_init');
  emit('auth:changed', init.auth);
  if (init.smoke) return runSmoke(init.smokeDir);
  if (init.openDir) return invoke('workspace_open', { dir: init.openDir });
  if (init.lastWorkspace) shell.offerLastWorkspace(init.lastWorkspace);
}

main();
