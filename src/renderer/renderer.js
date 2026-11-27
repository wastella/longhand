import { basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { oneDark } from '@codemirror/theme-one-dark';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const app = {
  ws: null,
  config: { policy: 'strict', model: 'sonnet' },
  tabs: new Map(), // path -> { state, dirty, mtime }
  active: null,
  view: null,
  expanded: new Set(),
  busy: false,
  gen: 0,
  pendingContext: null, // { label, text } attached to the next question
  lastTests: null,
};

function status(msg, ms = 4000) {
  $('#status-msg').textContent = msg || '';
  clearTimeout(status.t);
  if (msg && ms) status.t = setTimeout(() => ($('#status-msg').textContent = ''), ms);
}

// ---------------------------------------------------------------- editor

function languageFor(path) {
  const ext = path.split('.').pop().toLowerCase();
  if (ext === 'py' || ext === 'pyi') return python();
  if (ext === 'md' || ext === 'markdown') return markdown();
  if (ext === 'json' || ext === 'jsonl' || ext === 'ipynb') return json();
  if (ext === 'yaml' || ext === 'yml') return yaml();
  return [];
}

function makeState(path, text) {
  return EditorState.create({
    doc: text,
    extensions: [
      basicSetup,
      keymap.of([indentWithTab]),
      indentUnit.of('    '),
      EditorState.tabSize.of(4),
      languageFor(path),
      oneDark,
      EditorView.theme({ '&': { backgroundColor: '#1c1d21' }, '.cm-gutters': { backgroundColor: '#1c1d21', border: 'none' } }, { dark: true }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) markDirty(path, true);
        if (u.selectionSet || u.docChanged) updateCursor();
      }),
    ],
  });
}

function markDirty(path, dirty) {
  const tab = app.tabs.get(path);
  if (!tab || tab.dirty === dirty) return;
  tab.dirty = dirty;
  renderTabs();
}

function updateCursor() {
  if (!app.view || !app.active) {
    $('#status-pos').textContent = '';
    $('#context-chip').textContent = app.pendingContext ? `Attached: ${app.pendingContext.label}` : '';
    return;
  }
  const s = app.view.state;
  const sel = s.selection.main;
  const line = s.doc.lineAt(sel.head);
  $('#status-pos').textContent = `Ln ${line.number}, Col ${sel.head - line.from + 1}`;
  let chip = `Sees: ${app.active}`;
  if (!sel.empty) {
    const a = s.doc.lineAt(sel.from).number;
    const b = s.doc.lineAt(sel.to).number;
    chip += a === b ? ` · line ${a} selected` : ` · lines ${a}–${b} selected`;
  }
  if (app.pendingContext) chip = `Attached: ${app.pendingContext.label} · ${chip}`;
  $('#context-chip').textContent = chip;
}

async function openFile(path) {
  if (!app.tabs.has(path)) {
    let r;
    try {
      r = await invoke('fs_read', { rel: path });
    } catch (e) {
      return status(String(e));
    }
    if (r.tooLarge || r.binary) return status(r.binary ? `${path} is a binary file` : `${path} is too large to open`);
    app.tabs.set(path, { state: makeState(path, r.text), dirty: false, mtime: r.mtime });
  }
  activate(path);
}

function activate(path) {
  if (app.active && app.view && app.tabs.has(app.active)) app.tabs.get(app.active).state = app.view.state;
  app.active = path;
  const tab = app.tabs.get(path);
  $('#welcome').hidden = true;
  if (!app.view) app.view = new EditorView({ state: tab.state, parent: $('#editor-host') });
  else app.view.setState(tab.state);
  app.view.dom.hidden = false;
  app.view.focus();
  $('#status-file').textContent = path;
  renderTabs();
  highlightTree();
  updateCursor();
}

function closeTab(path) {
  const tab = app.tabs.get(path);
  if (!tab) return;
  if (tab.dirty && !window.confirm(`${path} has unsaved changes. Close it anyway?`)) return;
  const order = [...app.tabs.keys()];
  const i = order.indexOf(path);
  app.tabs.delete(path);
  if (app.active === path) {
    app.active = null;
    const next = order[i + 1] || order[i - 1];
    if (next) activate(next);
    else {
      app.view.dom.hidden = true;
      $('#welcome').hidden = false;
      $('#status-file').textContent = '';
      updateCursor();
    }
  }
  renderTabs();
}

async function save(path = app.active) {
  const tab = app.tabs.get(path);
  if (!tab) return false;
  if (path === app.active) tab.state = app.view.state;
  try {
    const onDisk = await invoke('fs_mtime', { rel: path });
    if (onDisk > tab.mtime + 1 && !window.confirm(`${path} changed on disk since you opened it. Overwrite it with your version?`)) return false;
    const r = await invoke('fs_write', { rel: path, text: tab.state.doc.toString() });
    tab.mtime = r.mtime;
    markDirty(path, false);
    status(`Saved ${path}`, 1500);
    return true;
  } catch (e) {
    status(`Could not save: ${e}`, 8000);
    return false;
  }
}

function renderTabs() {
  const host = $('#tabs');
  host.replaceChildren();
  for (const [path, tab] of app.tabs) {
    const t = el('div', 'tab' + (path === app.active ? ' active' : '') + (tab.dirty ? ' dirty' : ''));
    t.title = path;
    t.append(el('span', null, path.split('/').pop()));
    const x = el('span', 'x');
    x.append(el('span', null, '×'));
    x.onclick = (e) => (e.stopPropagation(), closeTab(path));
    t.append(x);
    t.onclick = () => activate(path);
    host.append(t);
  }
}

// ---------------------------------------------------------------- file tree

async function renderTree() {
  const host = $('#tree');
  const frag = document.createDocumentFragment();
  const walk = async (rel, depth) => {
    let entries = [];
    try {
      entries = await invoke('fs_list', { rel });
    } catch {}
    for (const e of entries) {
      const row = el('div', 'node' + (e.dir ? ' dir' : ''));
      row.dataset.path = e.path;
      row.style.paddingLeft = 8 + depth * 12 + 'px';
      row.append(el('span', 'twist', e.dir ? (app.expanded.has(e.path) ? '▾' : '▸') : ''), el('span', 'label', e.name));
      row.onclick = () => {
        if (e.dir) {
          app.expanded.has(e.path) ? app.expanded.delete(e.path) : app.expanded.add(e.path);
          renderTree();
        } else openFile(e.path);
      };
      frag.append(row);
      if (e.dir && app.expanded.has(e.path)) await walk(e.path, depth + 1);
    }
  };
  await walk('', 0);
  host.replaceChildren(frag);
  highlightTree();
}

function highlightTree() {
  for (const n of document.querySelectorAll('#tree .node')) n.classList.toggle('active', n.dataset.path === app.active);
}

function newFile() {
  if (!app.ws || $('#tree .new-name')) return;
  $('#files').hidden = false;
  const base = app.active && app.active.includes('/') ? app.active.slice(0, app.active.lastIndexOf('/') + 1) : '';
  const input = el('input', 'new-name');
  input.value = base;
  input.placeholder = 'path/to/file.py';
  input.spellcheck = false;
  $('#tree').prepend(input);
  input.focus();
  input.setSelectionRange(base.length, base.length);
  let done = false;
  const finish = async (create) => {
    if (done) return;
    done = true;
    const name = input.value.trim().replace(/^\/+/, '');
    input.remove();
    if (!create || !name || name.endsWith('/')) return;
    try {
      await invoke('fs_create', { rel: name, dir: false });
      const parts = name.split('/').slice(0, -1);
      parts.forEach((_, i) => app.expanded.add(parts.slice(0, i + 1).join('/')));
      await renderTree();
      openFile(name);
    } catch (e) {
      status(String(e));
    }
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  };
  input.onblur = () => finish(false);
}

// ---------------------------------------------------------------- terminal

const term = { xterm: null, fit: null, id: 0 };

function setupTerminal() {
  term.xterm = new Terminal({
    fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
    fontSize: 12,
    theme: { background: '#1c1d21', foreground: '#d7d9de', cursor: '#d9a35b', selectionBackground: '#3d4150' },
    cursorBlink: true,
    scrollback: 5000,
  });
  term.fit = new FitAddon();
  term.xterm.loadAddon(term.fit);
  term.xterm.open($('#terminal'));
  term.xterm.onData((data) => term.id && invoke('term_input', { id: term.id, data }));
  term.xterm.onResize(({ cols, rows }) => term.id && invoke('term_resize', { id: term.id, cols, rows }));
  new ResizeObserver(() => fitTerminal()).observe($('#terminal'));
  listen('term:data', (e) => e.payload.id === term.id && term.xterm.write(e.payload.data));
  listen('term:exit', (e) => {
    if (e.payload.id !== term.id) return;
    term.id = 0;
    term.xterm.write('\r\n\x1b[2m[shell exited; press any key to restart]\x1b[0m\r\n');
    const once = term.xterm.onKey(() => (once.dispose(), startTerminal()));
  });
}

function fitTerminal() {
  if ($('#terminal').hidden || !$('#terminal').offsetHeight) return;
  try {
    term.fit.fit();
  } catch {}
}

async function startTerminal() {
  fitTerminal();
  term.xterm.reset();
  term.id = await invoke('term_start', { cols: term.xterm.cols, rows: term.xterm.rows });
}

// ---------------------------------------------------------------- tests

function showBottom(pane) {
  $('#bottom').hidden = false;
  for (const b of document.querySelectorAll('.tab-btn')) b.classList.toggle('active', b.dataset.pane === pane);
  $('#terminal').hidden = pane !== 'terminal';
  $('#tests').hidden = pane !== 'tests';
  $('#tests-actions').hidden = pane !== 'tests';
  if (pane === 'terminal') requestAnimationFrame(() => (fitTerminal(), term.xterm.focus()));
}

async function runTests(fileOnly) {
  if (!app.ws) return;
  let target = null;
  if (fileOnly) {
    if (!app.active || !/(^|\/)test_[^/]*\.py$|_test\.py$/.test(app.active)) return status('Open a test file (test_*.py) to run just that file');
    target = app.active;
  }
  // Tests run against what is on disk, so save first.
  for (const [path, tab] of app.tabs) if (tab.dirty) await save(path);
  showBottom('tests');
  $('#tests-badge').textContent = '…';
  $('#tests-badge').className = '';
  $('#tests-list').replaceChildren(el('p', 'dim pad', 'Running…'));
  $('#tests-detail').textContent = '';
  try {
    const cmd = await invoke('tests_run', { target });
    $('#tests-detail').textContent = `$ ${cmd}\n`;
  } catch (e) {
    $('#tests-list').replaceChildren(el('p', 'dim pad', String(e)));
  }
}

function renderTests(result) {
  app.lastTests = result;
  const list = $('#tests-list');
  list.replaceChildren();
  const failed = result.tests.filter((t) => t.status === 'FAILED' || t.status === 'ERROR');
  const badge = $('#tests-badge');
  if (result.cancelled) {
    badge.textContent = '';
    list.append(el('p', 'dim pad', 'Cancelled.'));
    return;
  }
  if (!result.tests.length) {
    badge.textContent = '';
    list.append(el('p', 'dim pad', result.summary || 'No test results. The full output is on the right.'));
    $('#tests-detail').textContent = result.output;
    return;
  }
  badge.textContent = failed.length ? `${failed.length} failing` : 'passing';
  badge.className = failed.length ? 'fail' : 'pass';
  list.append(el('div', 'tests-summary', result.summary || `${result.tests.length} tests`));
  const order = [...failed, ...result.tests.filter((t) => !failed.includes(t))];
  for (const t of order) {
    const row = el('div', `test ${t.status}`);
    row.title = t.id;
    row.append(el('span', 'dot'), el('span', 'name', t.id.split('::').slice(1).join(' › ') || t.id));
    if (failed.includes(t)) {
      const ask = el('button', null, 'Ask tutor');
      ask.onclick = (e) => (e.stopPropagation(), attachFailure(t));
      row.append(ask);
    }
    row.onclick = () => {
      for (const n of list.querySelectorAll('.test')) n.classList.toggle('active', n === row);
      $('#tests-detail').textContent = t.detail || t.message || `${t.status} ${t.id}`;
    };
    list.append(row);
  }
  if (failed.length) list.querySelector('.test').click();
  else $('#tests-detail').textContent = result.output;
}

// Help with a failure starts from the student's own read of it.
function attachFailure(t) {
  const detail = (t.detail || t.message || '').slice(0, 6000);
  app.pendingContext = { label: t.id.split('::').pop(), text: `Failing test: ${t.id}\n\nPytest output:\n${detail}` };
  $('#tutor').hidden = false;
  $('#input').placeholder = 'What did you expect to happen, and what have you tried so far?';
  $('#input').focus();
  updateCursor();
}

// ---------------------------------------------------------------- tutor

marked.setOptions({ gfm: true, breaks: false });
const WITHHOLD_LINES = { strict: 2, guided: 12 };
const PROSE_LANGS = new Set(['text', 'txt', 'console', 'bash', 'sh', 'shell', 'zsh', 'output', 'plaintext']);

function renderMarkdown(node, text, msg) {
  const html = DOMPurify.sanitize(marked.parse(text), { FORBID_TAGS: ['style', 'form', 'input', 'button', 'img'], FORBID_ATTR: ['style'] });
  node.innerHTML = html;
  for (const a of node.querySelectorAll('a')) {
    const href = a.getAttribute('href') || '';
    a.removeAttribute('href');
    if (/^https?:\/\//.test(href)) {
      a.title = href;
      a.onclick = () => invoke('open_external', { url: href });
    }
  }
  // Second check on the tutor's output: code blocks beyond the policy's limit stay hidden
  // until the student chooses to reveal them, and each reveal is recorded.
  const limit = WITHHOLD_LINES[app.config.policy] ?? 2;
  node.querySelectorAll('pre').forEach((pre, i) => {
    const code = pre.querySelector('code');
    const lang = ((code && code.className.match(/language-(\S+)/)) || [])[1] || '';
    const lines = pre.textContent.replace(/\n+$/, '').split('\n').length;
    if (PROSE_LANGS.has(lang) || lines <= limit || msg.revealed.has(i)) return;
    if (msg.streaming) {
      pre.replaceWith(el('div', 'withheld', 'The tutor is writing code…'));
      return;
    }
    const box = el('div', 'withheld');
    box.append(el('span', null, `The tutor wrote ${lines} lines of code, hidden under the ${app.config.policy} policy.`));
    const btn = el('button', null, 'Reveal (logged)');
    btn.onclick = async () => {
      msg.revealed.add(i);
      renderRelianceFrom(await invoke('log_record', { kind: 'reveal', detail: { lines, policy: app.config.policy } }));
      renderMarkdown(node, text, msg);
    };
    box.append(btn);
    pre.replaceWith(box);
  });
}

function chatEmpty() {
  const box = el('div', 'empty');
  box.innerHTML =
    'The tutor can read this folder but cannot edit files or run anything.<ul><li>Ask what a function, error or equation means and get a straight answer.</li><li>Ask for a review of code you have written.</li><li>When a test fails, use <b>Ask tutor</b> on it and say what you expected.</li></ul>It will not write your assignment.';
  return box;
}

function scrollChat() {
  const c = $('#chat');
  c.scrollTop = c.scrollHeight;
}

let current = null; // the tutor message being streamed

function setBusy(busy) {
  app.busy = busy;
  $('#send').hidden = busy;
  $('#stop').hidden = !busy;
}

function editorContext() {
  if (!app.view || !app.active) return '';
  const s = app.view.state;
  const sel = s.selection.main;
  const tab = app.tabs.get(app.active);
  const lines = [`Open file: ${app.active} (cursor on line ${s.doc.lineAt(sel.head).number})`];
  if (tab && tab.dirty) lines.push('The file has unsaved edits, so the copy on disk is older than what the student sees.');
  if (!sel.empty) {
    const a = s.doc.lineAt(sel.from).number;
    const b = s.doc.lineAt(sel.to).number;
    lines.push(`Selected lines ${a}-${b}:\n${s.sliceDoc(sel.from, sel.to).slice(0, 6000)}`);
  }
  return lines.join('\n');
}

async function ask(question, kind = 'question') {
  question = question.trim();
  if (!question || app.busy || !app.ws) return;
  const attached = app.pendingContext;
  app.pendingContext = null;
  $('#input').placeholder = 'Ask about a concept, an API, an error, or your own code';
  const context = [editorContext(), attached && attached.text].filter(Boolean).join('\n\n');
  const prompt = context ? `<context>\n${context}\n</context>\n\n${question}` : question;

  const chat = $('#chat');
  if (chat.querySelector('.empty')) chat.replaceChildren();
  const mine = el('div', 'msg user', question);
  if (attached) mine.append(el('span', 'ctx', `Attached: ${attached.label}`));
  chat.append(mine);
  const node = el('div', 'msg tutor');
  node.append(el('span', 'thinking', 'Thinking…'));
  chat.append(node);
  scrollChat();
  current = { node, text: '', revealed: new Set(), streaming: true, activity: null, raf: 0 };
  setBusy(true);
  updateCursor();
  try {
    app.gen = await invoke('tutor_ask', { prompt, kind: attached ? 'failure' : kind });
    renderRelianceFrom(await invoke('log_summary'));
  } catch (e) {
    finishTutor({ type: 'error', message: String(e) });
  }
}

function finishTutor(ev) {
  const msg = current;
  if (!msg) return;
  current = null;
  msg.streaming = false;
  cancelAnimationFrame(msg.raf);
  if (msg.activity) msg.activity.remove();
  if (msg.text.trim()) renderMarkdown(msg.node, msg.text, msg);
  else msg.node.remove();
  if (ev.type === 'error') $('#chat').append(el('div', 'msg error', ev.message));
  else if (ev.cancelled) $('#chat').append(el('div', 'activity', 'Stopped.'));
  setBusy(false);
  scrollChat();
  if (smoke.onTutorDone) smoke.onTutorDone({ ev, text: msg.text });
}

function onTutorEvent(ev) {
  if (ev.gen !== app.gen && app.gen) return;
  const msg = current;
  if (!msg) return;
  if (ev.type === 'text' || ev.type === 'block') {
    if (ev.type === 'block' && msg.text && !msg.text.endsWith('\n\n')) msg.text += '\n\n';
    if (ev.text) msg.text += ev.text;
    if (msg.activity) (msg.activity.remove(), (msg.activity = null));
    if (!msg.raf)
      msg.raf = requestAnimationFrame(() => {
        msg.raf = 0;
        if (current !== msg) return;
        const c = $('#chat');
        const pinned = c.scrollHeight - c.scrollTop - c.clientHeight < 60;
        if (msg.text) renderMarkdown(msg.node, msg.text, msg);
        if (pinned) scrollChat();
      });
  } else if (ev.type === 'tool') {
    const verb = { Read: 'Reading', Grep: 'Searching for', Glob: 'Looking for' }[ev.name] || ev.name;
    const target = String(ev.target || '').replace(app.ws.path + '/', '');
    if (!msg.activity) {
      msg.activity = el('div', 'activity');
      msg.node.after(msg.activity);
    }
    msg.activity.textContent = `${verb} ${target}`;
    scrollChat();
  } else if (ev.type === 'done' || ev.type === 'error') {
    finishTutor(ev);
  }
}

async function newConversation() {
  await invoke('tutor_reset');
  if (current) finishTutor({ type: 'done', cancelled: true });
  app.pendingContext = null;
  $('#chat').replaceChildren(chatEmpty());
  updateCursor();
}

function quick(kind) {
  if (!app.ws) return;
  if (kind === 'selection') {
    if (!app.view || !app.active || app.view.state.selection.main.empty) return status('Select some code in the editor first');
    ask('Explain what the selected code does and why, line by line where it matters.', 'explain');
  } else if (kind === 'review') {
    if (!app.active) return status('Open the file you want reviewed');
    save().then(() => ask(`Review ${app.active}, which I wrote. Give me observations and questions tied to line ranges. Do not rewrite it.`, 'review'));
  } else if (kind === 'hint') {
    $('#input').value = "I'm stuck on ";
    $('#input').focus();
  }
}

function renderRelianceFrom(log) {
  if (!log) return;
  const t = log.today;
  const parts = [`${t.ask} ${t.ask === 1 ? 'question' : 'questions'}`];
  if (t.reveal) parts.push(`${t.reveal} code ${t.reveal === 1 ? 'reveal' : 'reveals'}`);
  $('#reliance').textContent = `Today: ${parts.join(' · ')}`;
}

function renderAuth(auth) {
  const n = $('#auth');
  if (!auth.installed) {
    n.className = 'bad';
    n.textContent = 'Claude Code not found';
    n.title = 'Install Claude Code, then run `claude` in the terminal and log in.';
  } else if (!auth.loggedIn) {
    n.className = 'bad';
    n.textContent = 'Not logged in';
    n.title = 'Run `claude` in the terminal below and log in with your Claude account, then reopen the folder.';
  } else {
    n.className = 'ok';
    n.textContent = auth.plan ? `Claude ${auth.plan[0].toUpperCase()}${auth.plan.slice(1)}` : 'Claude connected';
    n.title = 'The tutor uses your Claude subscription through Claude Code on this Mac.';
  }
}

// ---------------------------------------------------------------- layout

function setupSplitters() {
  for (const s of document.querySelectorAll('.split-v, .split-h')) {
    s.addEventListener('mousedown', (down) => {
      down.preventDefault();
      const target = $('#' + s.dataset.target);
      const horizontal = s.classList.contains('split-h');
      const start = horizontal ? down.clientY : down.clientX;
      const size = horizontal ? target.offsetHeight : target.offsetWidth;
      // Panes to the right of / below their splitter grow when dragged the other way.
      const sign = s.dataset.target === 'files' ? 1 : -1;
      const move = (e) => {
        const delta = ((horizontal ? e.clientY : e.clientX) - start) * sign;
        const next = Math.max(horizontal ? 80 : 160, Math.min(size + delta, horizontal ? window.innerHeight - 200 : 700));
        target.style[horizontal ? 'height' : 'width'] = next + 'px';
      };
      const up = () => (window.removeEventListener('mousemove', move), window.removeEventListener('mouseup', up));
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }
}

function toggle(id) {
  const n = $('#' + id);
  n.hidden = !n.hidden;
  if (id === 'bottom' && !n.hidden) requestAnimationFrame(fitTerminal);
}

function onMenu(id) {
  const actions = {
    'new-file': newFile,
    save: () => save(),
    'close-tab': () => app.active && closeTab(app.active),
    'toggle-files': () => toggle('files'),
    'toggle-bottom': () => toggle('bottom'),
    'toggle-tutor': () => (toggle('tutor'), !$('#tutor').hidden && $('#input').focus()),
    'run-tests': () => runTests(false),
    'run-tests-file': () => runTests(true),
    'ask-selection': () => quick('selection'),
    'review-file': () => quick('review'),
    'new-conversation': newConversation,
  };
  if (actions[id]) actions[id]();
}

async function onWorkspace(ws) {
  app.ws = ws;
  app.config = ws.config;
  app.tabs.clear();
  app.active = null;
  app.expanded.clear();
  app.lastTests = null;
  if (app.view) app.view.dom.hidden = true;
  $('#welcome').hidden = false;
  $('#welcome p').textContent = 'Pick a file on the left to start writing.';
  $('#open-folder').hidden = true;
  $('#welcome-last').hidden = true;
  $('#ws-name').textContent = ws.name;
  $('#policy').value = ws.config.policy;
  const note = $('#course-note');
  note.hidden = !ws.courseRules;
  note.textContent = ws.courseRules ? `Following this course's rules for AI (${ws.courseRules}).` : '';
  $('#chat').replaceChildren(chatEmpty());
  $('#tests-list').replaceChildren(el('p', 'dim pad', 'Run the tests to see results here.'));
  $('#tests-detail').textContent = '';
  $('#tests-badge').textContent = '';
  renderTabs();
  renderRelianceFrom(ws.log);
  updateCursor();
  await renderTree();
  await startTerminal();
  if (smoke.onWorkspace) smoke.onWorkspace();
}

// ---------------------------------------------------------------- self-test
// Run with LONGHAND_SMOKE=1: drives the real window end to end and reports to the backend.

const smoke = {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function runSmoke(dir) {
  const r = {};
  try {
    const opened = new Promise((res) => (smoke.onWorkspace = res));
    await invoke('workspace_open', { dir });
    await opened;
    r.tree = [...document.querySelectorAll('#tree .node')].map((n) => n.dataset.path);
    r.courseRules = app.ws.courseRules;
    r.policy = app.config.policy;

    await openFile('calc.py');
    r.highlighted = app.view.dom.querySelectorAll('.cm-line span').length > 0;
    app.view.dispatch({ changes: { from: app.view.state.doc.length, insert: '\n# edited in smoke test\n' } });
    r.dirty = app.tabs.get('calc.py').dirty;
    r.saved = await save();
    r.onDisk = (await invoke('fs_read', { rel: 'calc.py' })).text.includes('edited in smoke test');
    r.escape = await invoke('fs_read', { rel: '../outside.txt' }).then(() => 'ALLOWED', (e) => String(e));

    let termOut = '';
    const un = await listen('term:data', (e) => (termOut += e.payload.data));
    await wait(1500);
    await invoke('term_input', { id: term.id, data: 'echo smoke-$((40+2))\r' });
    await until(() => termOut.includes('smoke-42'), 10000, 'terminal echo');
    r.terminal = true;
    un();

    const tests = new Promise((res) => (smoke.onTests = res));
    await runTests(false);
    const t = await Promise.race([tests, wait(90000).then(() => { throw new Error('timed out waiting for tests'); })]);
    r.tests = { summary: t.summary, statuses: t.tests.map((x) => `${x.status} ${x.id}`), hasDetail: t.tests.some((x) => x.detail.includes('assert')) };
    r.failButtons = document.querySelectorAll('#tests-list .test button').length;

    if (!window.__SMOKE_SKIP_TUTOR) {
      const done = () => new Promise((res) => (smoke.onTutorDone = res));
      let d = done();
      await ask('In one sentence: what does the file calc.py in this folder define? Read it first.');
      let a = await d;
      r.tutor1 = { type: a.ev.type, message: a.ev.message, text: a.text.slice(0, 300) };
      d = done();
      await ask('Write the complete corrected implementation of add() for me as a Python code block.');
      a = await d;
      r.tutor2 = { type: a.ev.type, message: a.ev.message, text: a.text.slice(0, 600), withheld: document.querySelectorAll('.withheld').length, hasFence: a.text.includes('```') };
      r.reliance = $('#reliance').textContent;
    }
    {
      const probe = el('div', 'msg tutor');
      $('#chat').append(probe);
      const fake = { revealed: new Set(), streaming: false };
      const md = 'Here:\n\n```python\ndef add(a, b):\n    c = a + b\n    return c\n```\n\nand `pytest -q`:\n\n```bash\nuv run pytest\n```';
      renderMarkdown(probe, md, fake);
      r.withhold = { hidden: probe.querySelectorAll('.withheld').length, shownPre: probe.querySelectorAll('pre').length };
      probe.querySelector('.withheld button').click();
      await wait(400);
      r.withhold.afterReveal = { hidden: probe.querySelectorAll('.withheld').length, shownPre: probe.querySelectorAll('pre').length, reliance: $('#reliance').textContent };
      probe.remove();
    }
    const box = (sel) => { const b = $(sel).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
    showBottom('terminal');
    await wait(300);
    r.layout = { window: [innerWidth, innerHeight], files: box('#files'), editor: box('#editor-host .cm-editor'), bottom: box('#bottom'), xterm: box('#terminal .xterm-screen'), tutor: box('#tutor'), chat: box('#chat'), input: box('#input'), status: box('#status') };
    r.term = { cols: term.xterm.cols, rows: term.xterm.rows };
    r.fonts = { editor: getComputedStyle($('.cm-scroller')).fontFamily.slice(0, 30), lineNumbers: !!$('.cm-lineNumbers') };
    r.ok = r.withhold.hidden === 1 && r.withhold.afterReveal.shownPre === 2 && r.saved && r.onDisk && r.escape !== 'ALLOWED' && r.terminal && r.tests.statuses.length === 2 && (!r.tutor1 || (r.tutor1.type === 'done' && r.tutor1.text.length > 0));
  } catch (e) {
    r.ok = false;
    r.error = String(e && e.stack ? e.stack : e);
  }
  await invoke('smoke_result', { result: r });
}

// ---------------------------------------------------------------- start

async function main() {
  setupTerminal();
  setupSplitters();
  listen('workspace:opened', (e) => onWorkspace(e.payload));
  listen('menu', (e) => onMenu(e.payload));
  listen('tests:output', (e) => ($('#tests-detail').textContent += e.payload));
  listen('tests:done', (e) => (renderTests(e.payload), smoke.onTests && smoke.onTests(e.payload)));
  listen('tutor:event', (e) => onTutorEvent(e.payload));

  $('#open-folder').onclick = () => invoke('workspace_choose');
  $('#new-file').onclick = newFile;
  $('#new-chat').onclick = newConversation;
  $('#run-all-tests').onclick = () => runTests(false);
  $('#run-file-tests').onclick = () => runTests(true);
  $('#stop').onclick = () => invoke('tutor_cancel');
  for (const b of document.querySelectorAll('.tab-btn')) b.onclick = () => showBottom(b.dataset.pane);
  for (const b of document.querySelectorAll('#quick button')) b.onclick = () => quick(b.dataset.quick);
  $('#policy').onchange = async (e) => {
    app.config = await invoke('config_set', { patch: { policy: e.target.value } });
    await newConversation();
    status(`Tutor policy set to ${app.config.policy}; started a new conversation`);
  };
  $('#ask').onsubmit = (e) => {
    e.preventDefault();
    const text = $('#input').value;
    if (!text.trim() || app.busy) return;
    $('#input').value = '';
    ask(text);
  };
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $('#ask').requestSubmit();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if ([...app.tabs.values()].some((t) => t.dirty)) e.preventDefault();
  });

  const init = await invoke('app_init');
  renderAuth(init.auth);
  if (init.smoke) return runSmoke(init.smokeDir);
  if (init.openDir) return invoke('workspace_open', { dir: init.openDir });
  if (init.lastWorkspace) {
    const last = $('#welcome-last');
    last.textContent = '';
    const link = el('button', 'ghost', `Reopen ${init.lastWorkspace.split('/').pop()}`);
    link.onclick = () => invoke('workspace_open', { dir: init.lastWorkspace });
    last.append(link);
  }
}

main();
