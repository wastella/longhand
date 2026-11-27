// The end-to-end self-test, run when the app starts with LONGHAND_SMOKE=1 (see CONTRIBUTING.md).
// It drives the real window against the real backend and reports the result to it.

import { EditorView } from '@codemirror/view';
import { invoke, listen } from './backend.js';
import { h } from './dom.js';
import { once, state } from './state.js';
import { activeFile, openFile, save } from './editor/index.js';
import { runCommand, showBottomPane } from './shell/index.js';
import { sendToTerminal, terminalSize } from './terminal/index.js';
import { ask, renderAnswer, tutorRequest } from './tutor/index.js';

const $ = (selector) => document.querySelector(selector);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await wait(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const box = (selector) => {
  const b = $(selector).getBoundingClientRect();
  return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
};

async function checkEditor(r) {
  await openFile('calc.py');
  const view = EditorView.findFromDOM($('#editor-host .cm-editor'));
  r.highlighted = view.dom.querySelectorAll('.cm-line span').length > 0;
  view.dispatch({ changes: { from: view.state.doc.length, insert: '\n# edited in smoke test\n' } });
  r.dirty = activeFile().dirty;
  r.saved = await save();
  r.onDisk = (await invoke('fs_read', { rel: 'calc.py' })).text.includes('edited in smoke test');
  r.escape = await invoke('fs_read', { rel: '../outside.txt' }).then(
    () => 'ALLOWED',
    (e) => String(e),
  );
}

async function checkTerminal(r) {
  let output = '';
  let lastData = Date.now();
  const unlisten = await listen('term:data', ({ data }) => {
    output += data;
    lastData = Date.now();
  });
  try {
    // A login shell can take seconds to print its first prompt; typing before then can be lost.
    await until(() => output.length > 0 && Date.now() - lastData > 700, 20000, 'the shell prompt');
    await sendToTerminal('echo smoke-$((40+2))\r');
    await until(() => output.includes('smoke-42'), 20000, 'terminal echo');
    r.terminal = true;
  } catch (e) {
    throw new Error(`${e.message}; terminal output ended with ${JSON.stringify(output.slice(-300))}`);
  } finally {
    unlisten();
  }
}

async function checkTests(r) {
  const finished = once('tests:finished');
  await runCommand('run-tests');
  const t = await Promise.race([
    finished,
    wait(90000).then(() => {
      throw new Error('timed out waiting for tests');
    }),
  ]);
  r.tests = { summary: t.summary, statuses: t.tests.map((x) => `${x.status} ${x.id}`), hasDetail: t.tests.some((x) => x.detail.includes('assert')) };
  r.failButtons = document.querySelectorAll('#tests-list .test button').length;
}

async function askAndWait(question) {
  const finished = once('tutor:finished');
  await ask(question);
  return finished;
}

async function checkTutor(r) {
  let a = await askAndWait('In one sentence: what does the file calc.py in this folder define? Read it first.');
  r.tutor1 = { type: a.ev.type, message: a.ev.message, text: a.text.slice(0, 300) };
  a = await askAndWait('Write the complete corrected implementation of add() for me as a Python code block.');
  r.tutor2 = {
    type: a.ev.type,
    message: a.ev.message,
    text: a.text.slice(0, 600),
    withheld: document.querySelectorAll('.withheld').length,
    hasFence: a.text.includes('```'),
  };
  r.reliance = $('#reliance').textContent;
  // A lookup runs with no tools at all and is counted like any other question.
  const lookup = await tutorRequest({ thread: 'lookup-smoke', kind: 'lookup', prompt: 'In one sentence: what does len() return for a Python list?' }).done;
  r.lookup = { status: lookup.status, text: lookup.text.slice(0, 200), error: lookup.error };
  await wait(400);
  r.relianceAfterLookup = $('#reliance').textContent;
}

async function checkFiles(r) {
  const { files } = await invoke('fs_files');
  r.quickOpen = { hasCode: files.includes('calc.py'), hasIgnored: files.some((f) => f.startsWith('.venv/') || f.startsWith('.longhand/')) };
}

async function checkHiddenCode(r) {
  const probe = h('div', { class: 'msg tutor' });
  $('#chat').append(probe);
  const md = 'Here:\n\n```python\ndef add(a, b):\n    c = a + b\n    return c\n```\n\nand `pytest -q`:\n\n```bash\nuv run pytest\n```';
  renderAnswer(probe, md, { revealed: new Set(), streaming: false });
  r.withhold = { hidden: probe.querySelectorAll('.withheld').length, shownPre: probe.querySelectorAll('pre').length };
  probe.querySelector('.withheld button').click();
  await wait(400);
  r.withhold.afterReveal = {
    hidden: probe.querySelectorAll('.withheld').length,
    shownPre: probe.querySelectorAll('pre').length,
    reliance: $('#reliance').textContent,
  };
  probe.remove();
}

async function checkLayout(r) {
  showBottomPane('terminal');
  await wait(300);
  r.layout = {
    window: [innerWidth, innerHeight],
    files: box('#files'),
    editor: box('#editor-host .cm-editor'),
    bottom: box('#bottom'),
    xterm: box('#terminal .xterm-screen'),
    tutor: box('#tutor'),
    chat: box('#chat'),
    input: box('#input'),
    status: box('#status'),
  };
  r.term = terminalSize();
  r.fonts = { editor: getComputedStyle($('.cm-scroller')).fontFamily.slice(0, 30), lineNumbers: !!$('.cm-lineNumbers') };
}

/** Opens `dir`, exercises each area, and sends the result to the backend, which prints it and quits. */
export async function runSmoke(dir) {
  const r = {};
  try {
    const ready = once('workspace:ready');
    await invoke('workspace_open', { dir });
    await ready;
    r.tree = [...document.querySelectorAll('#tree .node')].map((n) => n.dataset.path);
    r.courseRules = state.workspace.courseRules;
    r.policy = state.config.policy;

    await checkEditor(r);
    await checkFiles(r);
    await checkTerminal(r);
    await checkTests(r);
    if (!window.__SMOKE_SKIP_TUTOR) await checkTutor(r);
    await checkHiddenCode(r);
    await checkLayout(r);
    r.ok =
      r.withhold.hidden === 1 &&
      r.withhold.afterReveal.shownPre === 2 &&
      r.saved &&
      r.onDisk &&
      r.escape !== 'ALLOWED' &&
      r.terminal &&
      r.tests.statuses.length === 2 &&
      r.quickOpen.hasCode &&
      !r.quickOpen.hasIgnored &&
      (!r.tutor1 ||
        (r.tutor1.type === 'done' &&
          r.tutor1.text.length > 0 &&
          r.tutor2.type === 'done' &&
          r.reliance.includes('2 questions') &&
          r.lookup.status === 'done' &&
          r.relianceAfterLookup.includes('3 questions')));
  } catch (e) {
    r.ok = false;
    r.error = String(e && e.stack ? e.stack : e);
  }
  await invoke('smoke_result', { result: r });
}
