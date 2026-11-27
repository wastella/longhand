// Language servers (lsp.rs). No server is installed unless a test says so, and each installed
// one is a small scripted server that speaks enough of the protocol to exercise the interface:
// it keeps the text it is sent, reports problems for a few marker words, and answers hover,
// definition, completion and signature requests about the fixture's Python.
//
// Options:
//   codeChecking: 'on' | 'off' | 'ask'             what the student decided for the fixture folder. The
//       real backend starts every folder at 'ask' (nothing decided, nothing runs); the mock
//       starts at 'on' so that tests of other areas are not about this question.
//   languageServers: { python: 'basedpyright' }   the servers installed, kind -> name, or kind ->
//       { name, python, failToStart: 'why', slow: ms, silent: true, crashOn: 'method', crashes: n,
//         diesAtOnce: 'stderr' }
//       `python` is the folder's interpreter; `slow` delays every answer; `silent` never answers;
//       `crashOn` makes it exit when it receives that method, and `diesAtOnce` makes it exit
//       before lsp_start has answered, each the first `crashes` times it is started (every
//       time when absent).
//   languageTiming: { ... }                         overrides the interface's waits (language/servers.js)
//   missingServerTold: false                        the student has not yet been told a server is missing
// Hooks: window.__lsp = { checking, installed, started: [{ id, kind }], stopped: [id], looks: [{ kind, look }],
//   received: [{ id, ...message }], docs: { uri: { text, version, languageId } }, acked: { id: bytes },
//   delivered: { id: bytes }, saved: [uri], settings: {}, answers: { name: response },
//   install(kind, server), crash(kind, stderr), say(kind, method, params), ask(kind, name, method, params) }.
// What the scripted server reports: `undefined_name` is an error, `import nowhere` a warning and
// `unused_name` a hint. `sqrt` is defined outside the folder, and completing it comes with an
// import to add. The documentation of `variance` carries markup that must not survive.

const mock = window.__mock;
const root = mock.workspace.path;
// A missing server is mentioned once per folder (language/status.js). The mock starts as if that
// had happened, so tests of other areas are not about it; `missingServerTold: false` starts afresh.
if (mock.options.missingServerTold === false) localStorage.removeItem('longhand.missingServerTold');
else localStorage.setItem('longhand.missingServerTold', JSON.stringify([`${root}|python`]));
const lsp = (window.__lsp = {
  checking: mock.options.codeChecking || 'on',
  installed: { ...mock.options.languageServers },
  started: [],
  stopped: [],
  looks: [],
  received: [],
  docs: {},
  acked: {},
  delivered: {},
  saved: [],
  settings: {},
  answers: {},
});
let nextId = 1;
/** id -> { kind, config, spawn } for servers that are running. */
const running = new Map();
const spawns = {};

const uriOf = (path) => `file://${root}/${path}`;
const configOf = (kind) => (typeof lsp.installed[kind] === 'string' ? { name: lsp.installed[kind] } : lsp.installed[kind]);

function exit(id, code, stderr = '') {
  if (!running.delete(id)) return;
  mock.emit('lsp:exit', { id, code, stderr });
}

function send(id, message) {
  const server = running.get(id);
  if (!server || server.config.silent) return;
  const text = JSON.stringify({ jsonrpc: '2.0', ...message });
  const bytes = new TextEncoder().encode(text).length;
  const deliver = () => {
    if (!running.has(id)) return;
    lsp.delivered[id] = (lsp.delivered[id] || 0) + bytes;
    mock.emit('lsp:message', { id, message: text, bytes });
  };
  setTimeout(deliver, server.config.slow || 0);
}

// ---- the scripted server ----

const offsetOf = (text, { line, character }) => text.split('\n').slice(0, line).join('\n').length + (line ? 1 : 0) + character;
function positionOf(text, offset) {
  const before = text.slice(0, offset).split('\n');
  return { line: before.length - 1, character: before.at(-1).length };
}
const rangeOf = (text, from, to) => ({ start: positionOf(text, from), end: positionOf(text, to) });

function wordAt(text, position) {
  const offset = offsetOf(text, position);
  const start = /\w*$/.exec(text.slice(0, offset))[0];
  const end = /^\w*/.exec(text.slice(offset))[0];
  return start + end;
}

const MARKERS = [
  [/\bundefined_name\b/g, 1, '"undefined_name" is not defined'],
  [/\bimport nowhere\b/g, 2, 'Import "nowhere" could not be resolved'],
  [/\bunused_name\b/g, 4, '"unused_name" is not accessed'],
];

function report(id, uri) {
  const doc = lsp.docs[uri];
  const diagnostics = [];
  if (doc)
    for (const [pattern, severity, message] of MARKERS)
      for (const match of doc.text.matchAll(pattern))
        diagnostics.push({ range: rangeOf(doc.text, match.index, match.index + match[0].length), severity, message, source: 'mock' });
  send(id, { method: 'textDocument/publishDiagnostics', params: { uri, version: doc?.version, diagnostics } });
}

function applyChange(doc, change) {
  if (!change.range) return change.text;
  return doc.text.slice(0, offsetOf(doc.text, change.range.start)) + change.text + doc.text.slice(offsetOf(doc.text, change.range.end));
}

// What a hostile or careless server might put in documentation: something that runs, something
// that loads, and somewhere to go.
const MARKUP =
  'How spread out the numbers are. <img src="https://example.com/pixel.png" onerror="window.__ran = true"> <script>window.__ran = true</script> ' +
  '<a href="https://example.com/a" onclick="window.__ran = true">raw link</a> [docs](https://example.com/b) <textarea>t</textarea><select><option>o</option></select>';

const DOCS = {
  RunningStats: '```python\nclass RunningStats\n```\nStatistics over a stream of numbers, without storing the stream.',
  push: '```python\n(method) def push(self, x: float) -> None\n```\nAdds one number to the stream.',
  variance: MARKUP,
};

/** Where `word` is defined: in an open file, else in the fixture folder. */
function definitionOf(word) {
  if (word === 'sqrt') return { uri: 'file:///usr/lib/python3.12/math.py', range: rangeOf('', 0, 0) };
  const pattern = new RegExp(`\\b(?:class|def) (${word})\\b`);
  const texts = { ...Object.fromEntries(Object.entries(mock.files).map(([path, text]) => [uriOf(path), text])) };
  for (const [uri, doc] of Object.entries(lsp.docs)) texts[uri] = doc.text;
  for (const [uri, text] of Object.entries(texts)) {
    const match = uri.endsWith('.py') && pattern.exec(text);
    if (match) {
      const from = match.index + match[0].length - word.length;
      return { uri, range: rangeOf(text, from, from + word.length) };
    }
  }
  return null;
}

const MEMBERS = [
  { label: 'count', kind: 5, detail: 'int' },
  { label: 'mean', kind: 5, detail: 'float' },
  { label: 'push', kind: 2, detail: '(x: float) -> None', documentation: { kind: 'markdown', value: 'Adds one number to the stream.' } },
  { label: 'variance', kind: 2, detail: '() -> float', documentation: { kind: 'markdown', value: MARKUP } },
];
const NAMES = [
  { label: 'RunningStats', kind: 7, detail: 'class' },
  { label: 'range', kind: 3, detail: 'builtin' },
  // As Pyright offers a name that is not imported yet: with the import to add at the top.
  {
    label: 'sqrt',
    kind: 3,
    detail: 'math',
    additionalTextEdits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'from math import sqrt\n' }],
  },
];

function answer(text, method, params) {
  const position = params.position;
  if (method === 'textDocument/hover') {
    const value = DOCS[wordAt(text, position)];
    return value ? { contents: { kind: 'markdown', value } } : null;
  }
  if (method === 'textDocument/definition') return definitionOf(wordAt(text, position));
  if (method === 'textDocument/completion') {
    const before = text.slice(0, offsetOf(text, position));
    return { isIncomplete: false, items: /\.\w*$/.test(before) ? MEMBERS : NAMES };
  }
  if (method === 'textDocument/signatureHelp') {
    const before = text.slice(0, offsetOf(text, position));
    if (!/push\([^)]*$/.test(before)) return null;
    return {
      signatures: [{ label: 'push(x: float) -> None', documentation: 'Adds one number to the stream.', parameters: [{ label: 'x: float' }] }],
      activeSignature: 0,
      activeParameter: 0,
    };
  }
  return undefined;
}

const CAPABILITIES = {
  textDocumentSync: { openClose: true, change: 2, save: { includeText: false } },
  completionProvider: { triggerCharacters: ['.'] },
  hoverProvider: true,
  definitionProvider: true,
  signatureHelpProvider: { triggerCharacters: ['(', ','] },
};

function receive(id, message) {
  const server = running.get(id);
  const { config } = server;
  lsp.received.push({ id, ...message });
  const crashes = config.crashOn && config.crashOn === message.method && (config.crashes == null || server.spawn <= config.crashes);
  if (crashes) return exit(id, 1, 'Traceback (most recent call last):\n  File "server.py", line 1\nRuntimeError: the mock server crashed');
  const { method, params } = message;
  if (method === 'initialize') return send(id, { id: message.id, result: { capabilities: CAPABILITIES } });
  // As Pyright does: ask the editor which Python to analyse with.
  if (method === 'initialized') return send(id, { id: `settings-${id}`, method: 'workspace/configuration', params: { items: [{ section: 'python' }] } });
  if (!method && String(message.id).startsWith('settings-')) return void (lsp.settings[server.kind] = message.result);
  if (!method && String(message.id).startsWith('ask-')) return void (lsp.answers[message.id.slice(4)] = message);
  const uri = params?.textDocument?.uri;
  if (method === 'textDocument/didOpen') {
    lsp.docs[uri] = { text: params.textDocument.text, version: params.textDocument.version, languageId: params.textDocument.languageId };
    return report(id, uri);
  }
  if (method === 'textDocument/didChange') {
    const doc = lsp.docs[uri];
    for (const change of params.contentChanges) doc.text = applyChange(doc, change);
    doc.version = params.textDocument.version;
    return report(id, uri);
  }
  if (method === 'textDocument/didClose') {
    delete lsp.docs[uri];
    return report(id, uri);
  }
  if (method === 'textDocument/didSave') return void lsp.saved.push(uri);
  if (message.id == null || !method) return;
  const result = lsp.docs[uri] ? answer(lsp.docs[uri].text, method, params) : undefined;
  send(id, result === undefined ? { id: message.id, error: { code: -32601, message: 'Not something the mock server does' } } : { id: message.id, result });
}

// ---- the backend's commands ----

function stop(id) {
  if (running.delete(id)) lsp.stopped.push(id);
}

Object.assign(mock.commands, {
  lsp_consent: () => (lsp.checking === 'ask' ? null : lsp.checking),
  lsp_consent_set: ({ on }) => {
    lsp.checking = on ? 'on' : 'off';
    if (!on) for (const id of [...running.keys()]) stop(id);
  },
  lsp_start: ({ kind, look }) => {
    // As the backend does: nothing is looked for, let alone started, for a folder not turned on.
    if (lsp.checking !== 'on') return { status: 'off' };
    lsp.looks.push({ kind, look });
    const config = configOf(kind);
    if (!config) return { status: 'missing' };
    if (config.failToStart) return { status: 'failed', message: config.failToStart };
    for (const [id, server] of running) if (server.kind === kind) stop(id);
    const id = nextId++;
    spawns[kind] = (spawns[kind] || 0) + 1;
    running.set(id, { kind, config, spawn: spawns[kind] });
    lsp.started.push({ id, kind });
    if (config.diesAtOnce && (config.crashes == null || spawns[kind] <= config.crashes)) exit(id, 127, config.diesAtOnce);
    return { status: 'started', id, server: config.name, path: `/usr/local/bin/${config.name}`, root, python: config.python ?? null };
  },
  lsp_send: ({ id, message }) => {
    if (running.has(id)) receive(id, JSON.parse(message));
  },
  lsp_ack: ({ id, bytes }) => void (lsp.acked[id] = (lsp.acked[id] || 0) + bytes),
  lsp_stop: ({ id }) => stop(id),
});

/** Plays the student installing a server while the app is open. */
lsp.install = (kind, server) => (lsp.installed[kind] = server);

const idOf = (kind) => [...running].find(([, server]) => server.kind === kind)?.[0];

/** Has the `kind` server send a notification of its own. */
lsp.say = (kind, method, params) => send(idOf(kind), { method, params });

/** Has the `kind` server ask the editor for something; the editor's response lands in `answers[name]`. */
lsp.ask = (kind, name, method, params) => send(idOf(kind), { id: `ask-${name}`, method, params });

/** Plays the `kind` server's process dying. */
lsp.crash = (kind, stderr = 'Segmentation fault') => {
  for (const [id, server] of running) if (server.kind === kind) exit(id, 139, stderr);
};
