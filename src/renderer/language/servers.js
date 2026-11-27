// The language servers running for the open folder: one per kind (kinds.js), started when the
// first file it reads is opened, told about every open file and every edit, restarted if it
// crashes, and stopped a little after its last file closes.
//
// A server runs the folder's code (its Python environment), so none is
// started, or even looked for, until the student has turned code checking on for the folder.
// The backend remembers that per folder and enforces it; `checking()` is what it said.
//
// A server is { kind, status, message, name, root, python, client, documents, ... } with status
//   'starting'  being found and started, or about to be started again after a crash
//   'running'   answering
//   'missing'   none is installed (asked again when there is reason to think that changed)
//   'failed'    one was found but would not start; `message` says why
//   'stopped'   it crashed too often and was given up on; `message` is the last thing it said

import DOMPurify from 'dompurify';
import { LSPClient } from '@codemirror/lsp-client';
import { invoke, listen } from '../backend.js';
import { Documents, fileUri } from './documents.js';
import { languageOf } from './kinds.js';
import { clearProblems, showProblems } from './problems.js';
import { createTransport } from './transport.js';

/** The waits. The interface tests shorten them (the mock's `languageTiming` option, applied in index.js). */
export const timing = {
  /** How long after the last edit the server is sent the new text. */
  sync: 300,
  /** How long a server may take to answer anything, start-up included; jdtls takes many seconds to begin. */
  request: 30000,
  /** The wait before each restart after a crash. One more crash than this within `crashWindow` and it is given up on. */
  restarts: [1000, 5000, 15000],
  crashWindow: 3 * 60 * 1000,
  /** How long a server with no file left open is kept, in case one is opened again. */
  idle: 30000,
  /** After the student is handed an install command: how often to look for the server, and how many times (install.js). */
  installCheck: 5000,
  installChecks: 36,
  /** How long the folder's Python environment must be left alone before the server is told it changed (environment.js). */
  environment: 1500,
};

/**
 * What the editor tells every server about itself, on top of what the client library declares.
 * Completions are plain names: a snippet would write the shape of the call for the student.
 */
const CAPABILITIES = {
  textDocument: { publishDiagnostics: { versionSupport: true }, completion: { completionItem: { snippetSupport: false } } },
  workspace: { configuration: true, workspaceFolders: true },
};
/** What the library declares and Longhand leaves out: these rewrite the student's code, or put the server's own messages on screen. */
const NOT_OFFERED = { textDocument: ['formatting', 'rename', 'references', 'declaration', 'implementation', 'typeDefinition'], window: ['showMessage'] };

const servers = new Map();
/** The open text files a server could read: path -> { kind, languageId, name }. */
const openFiles = new Map();
/** The last lsp_start asked for each kind, so the next one waits its turn. */
const asking = new Map();
/** Servers that ended before the page knew their id: id -> what they last said. */
const earlyExits = new Map();
const MAX_EARLY_EXITS = 16;
let enabled = true;
/** Code checking for the open folder: 'on', 'off', null when the student has not decided, undefined until the backend has said. */
let consent;
/** Counts folders opened, so an answer about one that has been left is dropped. */
let folder = 0;
let onChange = () => {};
let onChecking = () => {};

/** Calls `handler(kind)` whenever that kind's server changes status. */
export const watchServers = (handler) => (onChange = handler);

/** Calls `handler()` whenever what is known about code checking for the folder changes, or the first checkable file opens. */
export const watchChecking = (handler) => (onChecking = handler);

/** Code checking for the open folder: 'on', 'off', null when the student has not decided, undefined when not yet known. */
export const checking = () => consent;

/** Whether language servers are on at all (the setting). */
export const isEnabled = () => enabled;

/** Whether a file is open that a language server could check. */
export const hasCheckableFiles = () => openFiles.size > 0;

/** The server for `kind`, or undefined when none was asked for yet. */
export const serverOf = (kind) => servers.get(kind);

/** The server looking after the open file at `path`, if any. */
export const serverFor = (path) => servers.get(openFiles.get(path)?.kind);

const hasFiles = (kind) => [...openFiles.values()].some((language) => language.kind === kind);
const filesOf = (kind) =>
  [...openFiles].filter(([, language]) => language.kind === kind).map(([path, language]) => ({ path, languageId: language.languageId }));

function setStatus(server, status, message = '') {
  Object.assign(server, { status, message });
  onChange(server.kind);
}

/** The settings a server asks for. Pyright analyses with the folder's own interpreter, so imports resolve as they do when the code runs. */
export function settingsOf(server, section) {
  const settings = server.python ? { python: { pythonPath: server.python } } : {};
  return (section || '').split('.').reduce((value, key) => (key ? value?.[key] : value), settings) ?? null;
}

/** The answer to a request from the server, or undefined to refuse it. */
function answer(server, method, params) {
  if (method === 'workspace/configuration') return (params?.items || []).map((item) => settingsOf(server, item.section));
  if (method === 'workspace/workspaceFolders') return [{ uri: fileUri(server.root), name: server.root.split('/').pop() }];
  // Servers register for things after start-up and expect a plain yes.
  if (method === 'client/registerCapability' || method === 'client/unregisterCapability') return null;
  return undefined;
}

/** Hover text and documentation come from the server as Markdown; nothing in it may run, load or leave the window. */
const sanitize = (html) =>
  DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'img', 'svg', 'math'],
    FORBID_ATTR: ['style', 'href', 'src'],
  });

/** The library's `initialize` request without the capabilities in NOT_OFFERED, which it has no setting to leave out. */
function withoutUnoffered(message) {
  const request = JSON.parse(message);
  if (request.method !== 'initialize') return message;
  for (const [group, names] of Object.entries(NOT_OFFERED)) for (const name of names) delete request.params.capabilities[group]?.[name];
  return JSON.stringify(request);
}

/** A completion answer without the edits elsewhere in the file (added imports) that choosing an item would make. */
function namesOnly(result) {
  for (const item of result?.items || (Array.isArray(result) ? result : [])) delete item.additionalTextEdits;
  return result;
}

/** Connects to the server that was started. Resolves once it has answered, and rejects if it does not. */
function connect(server, found) {
  Object.assign(server, { id: found.id, name: found.server, root: found.root, python: found.python });
  const transport = createTransport(found.id, (method, params) => answer(server, method, params));
  // Looking for the word first spares parsing every edit that is sent.
  const send = (message) => transport.send(message.includes('"initialize"') ? withoutUnoffered(message) : message);
  server.transport = { ...transport, send };
  const client = new LSPClient({
    rootUri: fileUri(found.root),
    timeout: timing.request,
    workspace: (client) => (server.documents = new Documents(client, found.root, filesOf(server.kind))),
    sanitizeHTML: sanitize,
    notificationHandlers: {
      'textDocument/publishDiagnostics': (client, params) => (showProblems(client.workspace, params), true),
      // Servers announce indexing and the like; none of it is something a student must act on.
      'window/showMessage': () => true,
    },
    extensions: [{ clientCapabilities: CAPABILITIES }],
  });
  const request = client.request.bind(client);
  client.request = (method, params) => (method === 'textDocument/completion' ? request(method, params).then(namesOnly) : request(method, params));
  const ready = client.initializing;
  client.connect(server.transport);
  server.client = client;
  return ready;
}

/** Forgets the connection and what the server had reported. The process is the caller's business. */
function disconnect(server) {
  for (const timer of ['syncTimer', 'restartTimer', 'idleTimer']) clearTimeout(server[timer]);
  server.client?.disconnect();
  server.transport?.close();
  for (const file of server.documents?.files || []) clearProblems(file.path);
  Object.assign(server, { id: null, client: null, transport: null, documents: null });
}

const stopProcess = (id) => invoke('lsp_stop', { id }).catch(() => {});

/** The backend will not start servers here: code checking is off for the folder after all. */
function refused() {
  consent = 'off';
  stopAll();
  onChecking();
}

/**
 * Finds and starts the server for `kind`. A kind already known to be missing is asked about
 * again without the status changing unless one has turned up. `look` is how hard the backend
 * looks for a server it did not find where servers were last found: 'remembered' (no further),
 * 'fresh' or 'now' (see lsp.rs).
 */
async function start(kind, look = 'remembered') {
  const server = servers.get(kind) || { kind, crashes: [], attempt: 0 };
  servers.set(kind, server);
  const attempt = (server.attempt += 1);
  // Anything may happen while the backend looks: another folder, the setting, a crash.
  const current = () => servers.get(kind) === server && server.attempt === attempt;
  if (server.status !== 'missing') setStatus(server, 'starting');
  server.looking = true;
  // One at a time for a kind. The backend keeps the server of whichever call it finishes last,
  // which with two under way need not be the one the page is waiting for.
  const before = asking.get(kind);
  const ask = (async () => {
    await before;
    if (!current()) return null;
    return invoke('lsp_start', { kind, look }).catch((error) => ({ status: 'failed', message: String(error) }));
  })();
  asking.set(kind, ask);
  const found = await ask;
  if (!found) return;
  // A server that cannot run (a broken wrapper script, say) is often gone before this answer arrives.
  const died = found.status === 'started' && earlyExits.has(found.id);
  const lastWords = earlyExits.get(found.id);
  earlyExits.delete(found.id);
  if (!current()) return found.status === 'started' && !died && stopProcess(found.id);
  server.looking = false;
  if (found.status === 'off') return refused();
  if (found.status !== 'started') return setStatus(server, found.status === 'missing' ? 'missing' : 'failed', found.message);
  if (died) return crashed(Object.assign(server, { name: found.server }), lastWords);
  try {
    await connect(server, found);
  } catch {
    if (!current()) return;
    stopProcess(server.id);
    disconnect(server);
    return setStatus(server, 'failed', `${found.server} started but did not answer.`);
  }
  if (!current()) return;
  server.documents.announce();
  if (server.python) server.client.notification('workspace/didChangeConfiguration', { settings: settingsOf(server) });
  setStatus(server, 'running');
}

/** The server's process ended by itself: start it again after a pause, or give up if this keeps happening. */
function crashed(server, stderr) {
  disconnect(server);
  server.attempt += 1;
  const now = Date.now();
  server.crashes = [...server.crashes.filter((time) => now - time < timing.crashWindow), now];
  if (server.crashes.length > timing.restarts.length) {
    const lastWords = (stderr || '').trim().split('\n').slice(-6).join('\n');
    return setStatus(server, 'stopped', lastWords);
  }
  setStatus(server, 'starting');
  server.restartTimer = setTimeout(() => start(server.kind), timing.restarts[server.crashes.length - 1]);
}

function stop(kind) {
  const server = servers.get(kind);
  if (!server) return;
  servers.delete(kind);
  if (server.id != null) stopProcess(server.id);
  disconnect(server);
  onChange(kind);
}

function stopAll() {
  for (const kind of [...servers.keys()]) stop(kind);
}

function wanted(kind, look) {
  if (!enabled || consent !== 'on') return;
  const server = servers.get(kind);
  clearTimeout(server?.idleTimer);
  if (!server || (server.status === 'missing' && !server.looking)) start(kind, look);
}

function wantOpenKinds() {
  for (const kind of new Set([...openFiles.values()].map((language) => language.kind))) wanted(kind);
}

/** Stops the `kind` server and starts it afresh, for when what it was started with has changed. */
export function restart(kind) {
  stop(kind);
  if (hasFiles(kind)) wanted(kind);
}

/** A text file was opened in a tab. */
export function fileOpened(path) {
  const language = languageOf(path);
  if (!language) return;
  const first = openFiles.size === 0;
  openFiles.set(path, language);
  if (first) onChecking();
  wanted(language.kind);
  servers.get(language.kind)?.documents?.opened(path, language.languageId);
}

/** Its tab closed. */
export function fileClosed(path) {
  const language = openFiles.get(path);
  if (!language) return;
  openFiles.delete(path);
  const server = servers.get(language.kind);
  if (!server) return;
  server.documents?.closed(path);
  if (!hasFiles(language.kind)) server.idleTimer = setTimeout(() => stop(language.kind), timing.idle);
}

/** Its text changed: the server hears once the typing pauses, and at once before anything is asked of it. */
export function fileChanged(path) {
  const server = serverFor(path);
  if (server?.status !== 'running') return;
  clearTimeout(server.syncTimer);
  server.syncTimer = setTimeout(() => server.client?.sync(), timing.sync);
}

/** It was written to disk. Some servers only run their fuller checks then. */
export function fileSaved(path) {
  const server = serverFor(path);
  const file = server?.status === 'running' && server.documents.fileAt(path);
  const save = file && server.client.serverCapabilities?.textDocumentSync?.save;
  if (!save) return;
  server.client.sync();
  server.client.notification('textDocument/didSave', { textDocument: { uri: file.uri }, ...(save.includeText ? { text: file.doc.toString() } : {}) });
}

/**
 * Another folder was opened: its servers were stopped by the backend, and nothing is open yet.
 * Asks the backend whether code checking is on for this one.
 */
export async function folderChanged() {
  openFiles.clear();
  stopAll();
  consent = undefined;
  onChecking();
  const asked = (folder += 1);
  // A backend that cannot say is taken as a no, never as a yes.
  const decided = await invoke('lsp_consent').catch(() => 'off');
  if (asked !== folder) return;
  consent = decided;
  onChecking();
  wantOpenKinds();
}

/** Turns code checking on or off for the open folder; the backend remembers it. */
export async function setChecking(on) {
  const asked = folder;
  await invoke('lsp_consent_set', { on });
  if (asked !== folder) return;
  consent = on ? 'on' : 'off';
  if (on) wantOpenKinds();
  else stopAll();
  onChecking();
}

/** Turns language servers on or off (the setting). */
export function setEnabled(value) {
  if (value === enabled) return;
  enabled = value;
  if (enabled) wantOpenKinds();
  else stopAll();
  onChecking();
}

/** Looks again for servers that were missing, for when one may have been installed since. `look` as for `start`. */
export function recheckMissing(look = 'remembered') {
  for (const server of servers.values()) if (hasFiles(server.kind)) wanted(server.kind, look);
}

/** Whether a server an open file wants is missing. */
export const anyMissing = () => [...servers.values()].some((server) => server.status === 'missing');

/** Looks for the missing `kind` server now, asking the login shell afresh. Resolves to its status afterwards. */
export async function lookAgain(kind) {
  const server = servers.get(kind);
  if (server?.status === 'missing' && !server.looking) await start(kind, 'now');
  return servers.get(kind)?.status;
}

/** Starts a server that failed or was given up on, with a clean record. */
export function startAgain(kind) {
  const server = servers.get(kind);
  if (!server || server.status === 'starting' || server.status === 'running') return;
  clearTimeout(server.restartTimer);
  server.crashes = [];
  start(kind);
}

export function mountServers() {
  listen('lsp:message', ({ id, message, bytes }) => [...servers.values()].find((server) => server.id === id)?.transport.receive(message, bytes));
  listen('lsp:exit', ({ id, stderr }) => {
    const server = [...servers.values()].find((candidate) => candidate.id === id);
    if (server) return crashed(server, stderr);
    earlyExits.set(id, stderr || '');
    if (earlyExits.size > MAX_EARLY_EXITS) earlyExits.delete(earlyExits.keys().next().value);
  });
}
