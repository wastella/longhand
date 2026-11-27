// The status bar's word on the file in the editor: the count of its problems when it has any,
// or a warning when its language server will not run. Otherwise it says nothing. A server that
// is not installed is mentioned once per folder in a notification, whose sheet has the one
// command that installs it; File > Code Checking for This Folder… leads there again later.

import { nextDiagnostic } from '@codemirror/lint';
import { h, spacer } from '../dom.js';
import { state } from '../state.js';
import { activeFile, fileState, fileView } from '../editor/index.js';
import { notify, openSheet, showStatus } from '../shell/index.js';
import { typeInTerminal } from '../terminal/index.js';
import { KINDS, languageOf } from './kinds.js';
import { countProblems, problemAt } from './problems.js';
import { expectInstall } from './install.js';
import { checking, isEnabled, lookAgain, serverOf, startAgain } from './servers.js';

const dot = h('span', { class: 'status-dot' });
const label = h('span', {});
export const item = h('button', { id: 'status-language', class: 'status-item', type: 'button', hidden: true, onclick: () => act() }, dot, label);

/** What a click on the item does now. */
let act = () => {};
/** What has been announced this session, so each is said once: 'stopped:<kind>'. */
const announced = new Set();
/** Where the missing servers already announced are remembered, across sessions: ['<folder>|<kind>']. */
const TOLD_MISSING = 'longhand.missingServerTold';
/** Whether the status message is a problem's, to be cleared when the cursor leaves it. */
let showingProblem = false;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function show(text, { tip, tone = '', run = null }) {
  item.hidden = false;
  label.textContent = text;
  dot.hidden = !tone;
  dot.className = `status-dot ${tone}`;
  item.disabled = !run;
  if (tip) item.dataset.tip = tip;
  else delete item.dataset.tip;
  act = run || (() => {});
}

function nextProblem(path) {
  const view = fileView(path);
  if (!view) return;
  view.focus();
  nextDiagnostic(view);
}

/** Redraws the item for the file in the editor. */
export function renderStatus() {
  const file = activeFile();
  const language = file && languageOf(file.path);
  const server = language && isEnabled() && checking() === 'on' && serverOf(language.kind);
  if (!server || server.status === 'starting' || server.status === 'missing') return void (item.hidden = true);
  const { name } = language;
  const explain = () => showServerSheet(language.kind);
  if (server.status === 'failed') return show(`${name}: language server did not start`, { tone: 'warning', tip: 'Click to see why.', run: explain });
  if (server.status === 'stopped') return show(`${name}: language server stopped`, { tone: 'warning', tip: 'Click to see why.', run: explain });
  const { errors, warnings } = countProblems(fileState(file.path));
  if (!errors && !warnings) return void (item.hidden = true);
  const counts = [errors && plural(errors, 'error'), warnings && plural(warnings, 'warning')].filter(Boolean).join(', ');
  show(counts, { tone: errors ? 'danger' : 'warning', tip: `Checked by ${server.name}. Click to go to the next one.`, run: () => nextProblem(file.path) });
}

/** Says in the status bar what the problem under the cursor is, for reading it without the mouse. */
export function describeProblemAtCursor(cursor) {
  const state = cursor && fileState(cursor.path);
  const problem = state && problemAt(state, state.selection.main.head);
  if (problem)
    showStatus(`${problem.severity === 'error' ? 'Error' : problem.severity === 'warning' ? 'Warning' : 'Note'}: ${problem.message.split('\n')[0]}`, 0);
  else if (showingProblem) showStatus('');
  showingProblem = Boolean(problem);
}

function toldMissing() {
  try {
    return new Set(JSON.parse(localStorage.getItem(TOLD_MISSING)) || []);
  } catch {
    return new Set();
  }
}

/** Says once per folder that no server is installed: the status bar stays quiet about it. */
function announceMissing(kind) {
  const key = `${state.workspace?.path}|${kind}`;
  const told = toldMissing();
  if (!state.workspace || told.has(key)) return;
  told.add(key);
  try {
    localStorage.setItem(TOLD_MISSING, JSON.stringify([...told]));
  } catch {
    // Not remembered: it is said again next time, which is harmless.
  }
  notify({
    message: `No ${KINDS[kind].label} language server is installed, so errors are not underlined.`,
    action: { label: 'How to Install…', run: () => showServerSheet(kind) },
  });
}

/** Tells the student when a server is missing (once per folder) or was given up on (once). */
export function announce(kind) {
  const status = serverOf(kind)?.status;
  if (status === 'missing') return announceMissing(kind);
  if (status !== 'stopped') return void (status === 'running' && announced.delete(`stopped:${kind}`));
  if (announced.has(`stopped:${kind}`)) return;
  announced.add(`stopped:${kind}`);
  notify({
    message: `The ${KINDS[kind].label} language server keeps stopping, so errors are no longer underlined.`,
    action: { label: 'Details', run: () => showServerSheet(kind) },
  });
}

function missingSheet(kind, close) {
  const { label: language, install, note } = KINDS[kind];
  const result = h('span', { class: 'language-check', role: 'status' });
  const again = h('button', { class: 'button', type: 'button' }, 'Check Again');
  again.onclick = async () => {
    again.disabled = true;
    result.textContent = 'Looking…';
    const found = (await lookAgain(kind)) !== 'missing';
    if (found) return close();
    again.disabled = false;
    result.textContent = 'Still not found.';
  };
  const toTerminal = h('button', { class: 'button primary', type: 'button' }, 'Put in Terminal');
  toTerminal.onclick = () => {
    close();
    // Typed, not run: installing something is the student's call, made by pressing Return.
    typeInTerminal(install);
    expectInstall();
    showStatus('The command is in the terminal. Press Return there to run it.', 8000);
  };
  return {
    body: [
      h(
        'p',
        {},
        `With a language server installed, Longhand underlines errors as you type, shows documentation when you point at a name, and can take you to where something is defined. None was found for ${language} on this computer.`,
      ),
      h('p', { class: 'language-step' }, 'To install one, run this in a terminal:'),
      h('pre', { class: 'language-command' }, h('code', {}, install)),
      h('p', { class: 'language-note' }, `${note} Longhand notices by itself once it is installed.`),
    ],
    footer: [result, spacer(), again, toTerminal],
  };
}

function brokenSheet(kind, server, close) {
  const { label: language } = KINDS[kind];
  const name = server.name || 'The language server';
  const why =
    server.status === 'stopped'
      ? `${name} stopped several times in a row, so Longhand has stopped restarting it. Errors are not underlined in ${language} files until it runs again.`
      : `A language server for ${language} was found but did not start. ${server.message}`;
  const again = h('button', { class: 'button primary', type: 'button' }, 'Start Again');
  again.onclick = () => {
    close();
    startAgain(kind);
  };
  return {
    body: [
      h('p', {}, why),
      server.status === 'stopped' && server.message && h('p', { class: 'language-step' }, 'The last thing it said:'),
      server.status === 'stopped' && server.message && h('pre', { class: 'language-command' }, h('code', {}, server.message)),
    ],
    footer: [spacer(), again],
  };
}

/** Opens the explanation for the `kind` server: how to install it, or why it is not running. */
export function showServerSheet(kind) {
  const server = serverOf(kind);
  if (!server || server.status === 'running' || server.status === 'starting') return;
  let sheet;
  const close = () => sheet.close();
  const { body, footer } = server.status === 'missing' ? missingSheet(kind, close) : brokenSheet(kind, server, close);
  sheet = openSheet({ title: `${KINDS[kind].label} language server`, body, footer, className: 'language-sheet' });
}
