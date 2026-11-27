// The language servers running for the open folder: one per kind (kinds.js), started when the
// first file it reads is opened, told about every open file and every edit, restarted if it
// crashes, and stopped a little after its last file closes.
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
  /** After the student is handed an install command: how often to look for the server, and how many times. */
  installCheck: 5000,
  installChecks: 36,
  /** How long the folder's Python environment must be left alone before the server is told it changed. */
  environment: 1500,
};

/** Paths whose change means the Python environment may have: the environment itself and what declares it. */
const ENVIRONMENT = /(^|\/)(\.venv|venv|site-packages)(\/|$)|(^|\/)(pyproject\.toml|uv\.lock|requirements[^/]*\.txt|pyrightconfig\.json)$/;
const INTERPRETERS = ['.venv/bin/python', 'venv/bin/python'];

/** What the editor tells every server about itself, on top of what the client library declares. */
const CAPABILITIES = {
  textDocument: { publishDiagnostics: { versionSupport: true } },
  workspace: { configuration: true, workspaceFolders: true },
};

const servers = new Map();
/** The open text files a server could read: path -> { kind, languageId, name }. */
const openFiles = new Map();
let enabled = true;
let onChange = () => {};

/** Calls `handler(kind)` whenever that kind's server changes status. */
export const watchServers = (handler) => (onChange = handler);

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
function settingsOf(server, section) {
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
  DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'form', 'input', 'button', 'img', 'svg', 'math'], FORBID_ATTR: ['style', 'href', 'src'] });

function connect(server, found) {
  Object.assign(server, { id: found.id, name: found.server, root: found.root, python: found.python });
  server.transport = createTransport(found.id, (method, params) => answer(server, method, params));
  server.client = new LSPClient({
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
  }).connect(server.transport);
}

/** Forgets the connection and what the server had reported. The process is the caller's business. */
function disconnect(server) {
  for (const timer of ['syncTimer', 'restartTimer', 'idleTimer', 'environmentTimer']) clearTimeout(server[timer]);
  server.client?.disconnect();
  server.transport?.close();
  for (const file of server.documents?.files || []) clearProblems(file.path);
  Object.assign(server, { id: null, client: null, transport: null, documents: null });
}

const stopProcess = (id) => invoke('lsp_stop', { id }).catch(() => {});

/**
 * Finds and starts the server for `kind`. A kind already known to be missing is asked about
 * again without the status changing unless one has turned up.
 */
async function start(kind) {
  const server = servers.get(kind) || { kind, crashes: [], attempt: 0 };
  servers.set(kind, server);
  const attempt = (server.attempt += 1);
  // Anything may happen while the backend looks: another folder, the setting, a crash.
  const current = () => servers.get(kind) === server && server.attempt === attempt;
  if (server.status !== 'missing') setStatus(server, 'starting');
  let found;
  server.looking = true;
  try {
    found = await invoke('lsp_start', { kind });
  } catch (error) {
    found = { status: 'failed', message: String(error) };
  } finally {
    server.looking = false;
  }
  if (!current()) return found.status === 'started' && stopProcess(found.id);
  if (found.status !== 'started') return setStatus(server, found.status === 'missing' ? 'missing' : 'failed', found.message);
  connect(server, found);
  try {
    await server.client.initializing;
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

function wanted(kind) {
  if (!enabled) return;
  const server = servers.get(kind);
  clearTimeout(server?.idleTimer);
  if (!server || (server.status === 'missing' && !server.looking)) start(kind);
}

/** A text file was opened in a tab. */
export function fileOpened(path) {
  const language = languageOf(path);
  if (!language) return;
  openFiles.set(path, language);
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

/** It was written to disk. Some servers only run their fuller checks then (rust-analyzer runs cargo check). */
export function fileSaved(path) {
  const server = serverFor(path);
  const file = server?.status === 'running' && server.documents.fileAt(path);
  const save = file && server.client.serverCapabilities?.textDocumentSync?.save;
  if (!save) return;
  server.client.sync();
  server.client.notification('textDocument/didSave', { textDocument: { uri: file.uri }, ...(save.includeText ? { text: file.doc.toString() } : {}) });
}

/**
 * The Python server reads the environment once. After packages were installed it is told to look
 * again (Pyright re-reads its settings and with them what can be imported), and when the folder
 * has only now got an environment of its own, it is started again inside it.
 */
async function environmentChanged(server) {
  if (!server.python) {
    const found = await invoke('doc_stat', { paths: INTERPRETERS }).catch(() => []);
    if (servers.get('python') !== server || server.status !== 'running') return;
    if (found.some((file) => file.mtime != null)) {
      stop('python');
      return wanted('python');
    }
  }
  server.client.notification('workspace/didChangeConfiguration', { settings: settingsOf(server) });
}

/** Files changed on disk outside the editor (`paths` as files:changed gives them). */
export function filesChanged(paths) {
  const server = servers.get('python');
  if (server?.status !== 'running' || !paths.some((path) => path === '' || ENVIRONMENT.test(path))) return;
  clearTimeout(server.environmentTimer);
  server.environmentTimer = setTimeout(() => environmentChanged(server), timing.environment);
}

/** Another folder was opened: its servers were stopped by the backend, and nothing is open yet. */
export function folderChanged() {
  openFiles.clear();
  stopAll();
}

/** Turns language servers on or off (the setting). */
export function setEnabled(value) {
  if (value === enabled) return;
  enabled = value;
  if (!enabled) return stopAll();
  for (const kind of new Set([...openFiles.values()].map((language) => language.kind))) wanted(kind);
}

/** Looks again for servers that were missing, for when one may have been installed since. */
export function recheckMissing() {
  for (const server of servers.values()) if (hasFiles(server.kind)) wanted(server.kind);
}

/** Looks for the missing `kind` server now. Resolves to its status afterwards. */
export async function lookAgain(kind) {
  const server = servers.get(kind);
  if (server?.status === 'missing' && !server.looking) await start(kind);
  return servers.get(kind)?.status;
}

let installWatch = null;

/** The student was just handed an install command: keeps looking for a while, so the server is picked up when it lands. */
export function expectInstall() {
  clearInterval(installWatch);
  let left = timing.installChecks;
  installWatch = setInterval(() => {
    recheckMissing();
    left -= 1;
    if (left <= 0 || ![...servers.values()].some((server) => server.status === 'missing')) clearInterval(installWatch);
  }, timing.installCheck);
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
    if (server) crashed(server, stderr);
  });
}
