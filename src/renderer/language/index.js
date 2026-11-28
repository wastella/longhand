// Language servers: errors underlined as the student types, documentation on hover, go to
// definition, and completion that knows the code, for Python (kinds.js). Longhand runs whichever
// server is installed on the machine and installs none itself. What is deliberately absent: quick fixes, renaming, formatting and
// anything else that writes the student's code for them. Nothing runs for a folder until the
// student has turned code checking on for it (consent.js).
//
// Other areas import from this file only.

import { Compartment } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { hoverTooltips, serverCompletion, signatureHelp } from '@codemirror/lsp-client';
import { on } from '../state.js';
import { activeFile, fileView, registerFileExtension } from '../editor/index.js';
import { closeOnEscape } from '../shell/dismiss.js';
import { addStatusItem, registerCommand, registerSetting, runCommand, showStatus } from '../shell/index.js';
import { mentionChecking, showCheckingSheet } from './consent.js';
import { clearTrail, clickToDefinition, goBack, goToDefinition, trailRenamed } from './definition.js';
import { uriOf } from './documents.js';
import { filesChanged } from './environment.js';
import { mountInstallWatch } from './install.js';
import { languageOf } from './kinds.js';
import { clearProblems, problemLines, watchProblems } from './problems.js';
import {
  fileChanged,
  fileClosed,
  fileOpened,
  fileSaved,
  folderChanged,
  mountServers,
  serverOf,
  setEnabled,
  timing,
  watchChecking,
  watchServers,
} from './servers.js';
import { announce, describeProblemAtCursor, item, renderStatus } from './status.js';

const SETTING = 'language.servers';
// How long the pointer rests on a name before its documentation shows.
const HOVER_MS = 400;

// Without the library's keys: ⇧⌘↑ and ⇧⌘↓ select to the start and end of the file.
const signatures = () => signatureHelp({ keymap: false });
// The library has no way to put the signature away, so it sits in a slot that Escape empties
// and refills, which starts it afresh with nothing showing.
const signatureSlot = new Compartment();

const signatureShown = () => Boolean(document.querySelector('#editor-host .cm-lsp-signature-tooltip'));
// The completion list closes first when both are up, as it is the one in the way.
const completionShown = () => Boolean(document.querySelector('#editor-host .cm-tooltip-autocomplete'));

function closeSignature() {
  const file = activeFile();
  const view = file && fileView(file.path);
  if (!view) return;
  view.dispatch({ effects: signatureSlot.reconfigure([]) });
  view.dispatch({ effects: signatureSlot.reconfigure(signatures()) });
}

/** What a file with a running server gets; each part only if the server offers it. */
function served(server, path, languageId) {
  const offers = server.client.serverCapabilities || {};
  return [
    server.client.plugin(uriOf(server.root, path), languageId),
    // In place of the editor's own completion of words in the file, not beside it.
    offers.completionProvider ? serverCompletion({ override: true }) : [],
    offers.hoverProvider ? hoverTooltips({ hoverTime: HOVER_MS }) : [],
    offers.signatureHelpProvider ? signatureSlot.of(signatures()) : [],
    offers.definitionProvider ? clickToDefinition : [],
    problemLines,
  ];
}

function extensionFor(path) {
  const language = languageOf(path);
  const server = language && serverOf(language.kind);
  return server?.status === 'running' ? served(server, path, language.languageId) : [];
}

// Bound in every file: the menu's F12 may reach the page first, and Ctrl+- is the editor's alone
// (menu.rs gives it no accelerator, since it is undo in the terminal's shell).
const navigationKeys = keymap.of([
  { key: 'F12', run: () => (runCommand('go-to-definition'), true), preventDefault: true },
  { key: 'Ctrl--', run: () => (goBack(), true), preventDefault: true },
]);

function definitionOfSelection() {
  const file = activeFile();
  if (file?.custom) return showStatus('Go to Definition does not work in notebooks yet');
  const view = file && fileView(file.path);
  if (!view) return;
  view.focus();
  goToDefinition(view);
}

export function mount() {
  mountServers();
  registerSetting({
    id: SETTING,
    label: 'Check code as I type',
    description: 'Underline errors and show documentation, using the language servers installed on this computer.',
    type: 'toggle',
    default: true,
  });
  registerCommand('go-to-definition', definitionOfSelection);
  registerCommand('go-back', goBack);
  registerCommand('code-checking', showCheckingSheet);
  addStatusItem(item);
  closeOnEscape(() => signatureShown() && !completionShown(), closeSignature);
  mountInstallWatch();

  const refresh = registerFileExtension(extensionFor);
  registerFileExtension(() => navigationKeys);
  watchServers((kind) => {
    refresh((path) => languageOf(path)?.kind === kind);
    renderStatus();
    announce(kind);
  });
  watchProblems((path) => path === activeFile()?.path && renderStatus());
  watchChecking(() => {
    renderStatus();
    mentionChecking();
  });

  on('editor:opened', fileOpened);
  on('editor:closed', fileClosed);
  on('editor:changed', fileChanged);
  on('editor:saved', fileSaved);
  on('files:changed', filesChanged);
  on('editor:renamed', ({ from, to }) => {
    fileClosed(from);
    // The new name may be one no server reads, or another server's.
    clearProblems(to);
    fileOpened(to);
    trailRenamed(from, to);
  });
  on('editor:active', renderStatus);
  on('editor:cursor', describeProblemAtCursor);
  // After the editor has dropped the old folder's tabs (it mounts first).
  on('workspace:opened', () => {
    folderChanged();
    clearTrail();
    renderStatus();
  });
  on('settings:changed', ({ id, value }) => id === SETTING && setEnabled(value));
  // The interface tests shorten the waits; the real app never sets __MOCK__.
  Object.assign(timing, window.__MOCK__?.languageTiming);
}
