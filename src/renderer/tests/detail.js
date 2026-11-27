// The right side of the test pane: one test's result, or pytest's raw output.

import { h } from '../dom.js';
import { state } from '../state.js';
import { openFile } from '../editor/index.js';
import { duration, failed, shortName } from './model.js';

/** Longer text shows this many lines until the student asks for the rest. */
const LINES = { message: 40, section: 60, output: 1500 };

const STATUS = {
  PASSED: 'Passed',
  FAILED: 'Failed',
  ERROR: 'Error',
  SKIPPED: 'Skipped',
  XFAIL: 'Expected failure',
  XPASS: 'Passed unexpectedly',
};

const PHASE = {
  setup: 'It failed while setting up, in a fixture, before the test itself ran.',
  teardown: 'The test ran, then failed while cleaning up, in a fixture.',
  collect: 'pytest could not import this file, so none of its tests ran.',
};

/** A `path:line` that opens the file at that line. */
export function location(rel, line, text = line ? `${rel}:${line}` : rel) {
  return h('button', { type: 'button', class: 'tests-loc', title: `Open ${rel}`, onclick: () => openFile(rel, line) }, text);
}

/** The folder-relative path for a path in pytest's output, or null for files outside the student's code. */
function own(path) {
  const root = state.workspace?.path;
  if (root && path.startsWith(`${root}/`)) path = path.slice(root.length + 1);
  if (path.startsWith('/') || path.startsWith('..') || path.startsWith('.venv/') || path.includes('site-packages/')) return null;
  return path;
}

const PATHS = /File "([^"]+)", line (\d+)|((?:[\w.-]+\/)*[\w.-]+\.py):(\d+)/g;

/** Text with each `path:line` in the student's code made into a link. */
export function linkify(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(PATHS)) {
    const rel = own(match[1] || match[3]);
    if (!rel) continue;
    parts.push(text.slice(last, match.index), location(rel, Number(match[2] || match[4]), match[0]));
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

/**
 * A <pre> showing at most `limit` lines of `text` (the first ones, or the last with `fromEnd`),
 * with a button for the rest.
 */
function clipped(text, limit, { className = '', fromEnd = false, links = true } = {}) {
  const lines = text.split('\n');
  const pre = h('pre', { class: className });
  const show = (shown) => pre.replaceChildren(...(links ? linkify(shown) : [shown]));
  if (lines.length <= limit) {
    show(text);
    return pre;
  }
  show((fromEnd ? lines.slice(-limit) : lines.slice(0, limit)).join('\n'));
  const more = h('button', { type: 'button', class: 'ghost tests-more' }, `Show all ${lines.length.toLocaleString()} lines`);
  more.onclick = () => (show(text), more.remove());
  return fromEnd ? h('div', {}, more, pre) : h('div', {}, pre, more);
}

/**
 * A frame's lines without pytest's indentation. Its `E` marker becomes a class, so the
 * explanation lines up with the code it explains.
 */
function frameLines(lines) {
  const marked = lines.map((line) => (line.startsWith('E') ? { err: true, text: ` ${line.slice(1)}` } : { err: false, text: line }));
  const indent = Math.min(...marked.filter((l) => l.text.trim()).map((l) => l.text.match(/^ */)[0].length));
  return marked.map(({ err, text }) => {
    const shown = text.slice(Number.isFinite(indent) ? indent : 0);
    return h('div', { class: err ? 'err' : /^\s*\^+\s*$/.test(text) ? 'caret' : '' }, shown || ' ');
  });
}

function frameNode(frame) {
  if (frame.note) return h('p', { class: 'tests-note' }, ...linkify(frame.note));
  const where = frame.rel ? location(frame.rel, frame.line) : h('span', { class: 'tests-path' }, frame.line ? `${frame.path}:${frame.line}` : frame.path);
  const code = frameLines(frame.lines);
  return h(
    'div',
    { class: `tests-frame${frame.own ? ' own' : ''}` },
    h('div', { class: 'tests-frame-head' }, where, frame.func && h('span', { class: 'dim' }, ` in ${frame.func}`)),
    h('pre', {}, code),
  );
}

/**
 * The traceback, with runs of library frames folded away so the student's own frames stand out.
 * The last frame's explanation (its `E` lines) is left out: it is the message shown above.
 */
function traceback(frames) {
  const last = frames.findLastIndex((f) => !f.note);
  frames = frames.map((f, i) => (i === last ? { ...f, lines: f.lines.filter((l) => !l.startsWith('E')) } : f));
  const nodes = [];
  for (let i = 0; i < frames.length;) {
    if (frames[i].own || frames[i].note) {
      nodes.push(frameNode(frames[i++]));
      continue;
    }
    const run = [];
    while (i < frames.length && !frames[i].own && !frames[i].note) run.push(frames[i++]);
    const label = run.length === 1 ? '1 frame in library code' : `${run.length} frames in library code`;
    nodes.push(h('details', { class: 'tests-library' }, h('summary', {}, label), run.map(frameNode)));
  }
  return h('div', { class: 'tests-traceback' }, nodes);
}

function section({ title, text }) {
  const lines = text.replace(/\n$/, '').split('\n').length;
  const name = title.replace(/^Captured (\w+) (\w+)$/, (_, stream, phase) => `Captured ${stream}${phase === 'call' ? '' : ` (${phase})`}`);
  return h(
    'details',
    { class: 'tests-section' },
    h('summary', {}, name, h('span', { class: 'dim' }, ` · ${lines} ${lines === 1 ? 'line' : 'lines'}`)),
    clipped(text.replace(/\n$/, ''), LINES.section),
  );
}

/** Why a test that did not fail looks the way it does. */
function outcome(test) {
  const took = duration(test.duration);
  if (test.status === 'PASSED') return took ? `Passed in ${took}.` : 'Passed.';
  if (test.status === 'SKIPPED') return test.message ? `Skipped: ${test.message}` : 'Skipped.';
  if (test.status === 'XFAIL') return `Failed, as it is marked to${test.message ? ` (${test.message})` : ''}.`;
  if (test.status === 'XPASS') return `Passed, though it is marked as expected to fail${test.message ? ` (${test.message})` : ''}.`;
  return null;
}

/**
 * The detail of one result. `stale` adds a note that it ran before the latest save; `panel` is
 * a node another area attached to this failure (see failure-panels.js); `onRun` reruns it.
 */
export function testDetail(test, { stale, panel, onRun }) {
  const took = duration(test.duration);
  const head = h(
    'div',
    { class: 'tests-detail-head' },
    h('span', { class: `dot ${test.status}` }),
    h('span', { class: 'tests-detail-name' }, test.phase === 'collect' ? test.id : shortName(test)),
    h('span', { class: `tests-status ${test.status}` }, STATUS[test.status] || test.status),
    test.phase !== 'collect' && test.path && location(test.path, test.line),
    h('span', { class: 'spacer' }),
    took && h('span', { class: 'dim' }, took),
    h('button', { type: 'button', class: 'ghost', title: 'Run this test again', onclick: onRun }, test.phase === 'collect' ? 'Run file' : 'Run'),
  );
  const body = [head];
  if (stale) body.push(h('p', { class: 'tests-stale-note' }, 'This result is from before your last save.'));
  if (failed(test)) {
    if (PHASE[test.phase]) body.push(h('p', { class: 'tests-phase' }, PHASE[test.phase]));
    if (test.message) body.push(clipped(test.message, LINES.message, { className: 'tests-message' }));
    if (/^NotImplementedError\b/.test(test.message)) {
      body.push(h('p', { class: 'tests-hint' }, 'This is still the starter code: the function raises NotImplementedError until you write it.'));
    }
    // Worth saying only when the student's frame is not simply the first one shown.
    const first = test.frames.find((f) => !f.note);
    if (test.at?.rel && (first?.rel !== test.at.rel || first?.line !== test.at.line))
      body.push(h('p', { class: 'tests-at' }, 'Look first at ', location(test.at.rel, test.at.line), test.at.func ? ` in ${test.at.func}` : ''));
    if (test.frames.length) body.push(traceback(test.frames));
    else if (test.detail) body.push(clipped(test.detail, LINES.section, { className: 'tests-raw' }));
  } else {
    body.push(h('p', { class: 'tests-outcome' }, outcome(test)));
  }
  body.push(...test.sections.map(section));
  if (panel) body.push(h('div', { class: 'tests-failure-panel' }, panel));
  return body;
}

/** pytest's own output for the last run, as it would look in a terminal. */
export function rawOutput(output, command) {
  return [
    h(
      'div',
      { class: 'tests-detail-head' },
      h('span', { class: 'tests-detail-name tests-detail-title' }, 'Output'),
      command && h('code', { class: 'dim tests-command' }, `$ ${command}`),
    ),
    output ? clipped(output.replace(/\n$/, ''), LINES.output, { className: 'tests-raw', fromEnd: true }) : h('p', { class: 'empty-state' }, 'No output yet.'),
  ];
}
