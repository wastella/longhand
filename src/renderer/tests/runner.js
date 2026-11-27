// Starting and stopping runs, and what is known about the current run and the latest results.

import { invoke, listen } from '../backend.js';
import { merge } from './model.js';

/** Raw output kept in the interface while a run goes; the backend keeps the same amount. */
const OUTPUT_LIMIT = 2_000_000;

/** The run in progress. */
export const run = {
  active: false,
  startedAt: 0,
  /** pytest itself has started (before this, uv may be preparing the environment). */
  started: false,
  total: null,
  current: null,
  targets: [],
  tests: [],
  errors: [],
  output: '',
  command: '',
};

/** The latest results, merged across runs: a run of one file leaves the other files' results. */
export const results = {
  ran: false,
  tests: [],
  errors: [],
  problem: null,
  summary: '',
  cancelled: false,
  targets: [],
  output: '',
  command: '',
  /** Ids of results that ran before a file was saved, and the last file saved. */
  stale: new Set(),
  staleFile: null,
};

let notify = () => {};
let finished = () => {};
let savedDuringRun = null;

/** Starts listening to the backend. `onChange(what)` follows every change; `onDone(done)` each finished run. */
export function connect({ onChange, onDone }) {
  notify = onChange;
  finished = onDone;
  listen('tests:output', (text) => {
    if (!run.active) return;
    run.output = (run.output + text).slice(-OUTPUT_LIMIT);
    notify('output');
  });
  listen('tests:progress', (updates) => {
    if (!run.active) return;
    for (const update of updates) {
      if (update.type === 'started') run.started = true;
      else if (update.type === 'collected') run.total = update.total;
      else if (update.type === 'running') run.current = update.id;
      else if (update.type === 'result') run.tests.push(update.test);
      else if (update.type === 'collect-error') run.errors.push(update.test);
    }
    notify('progress');
  });
  listen('tests:done', (done) => run.active && end(done));
}

/** Runs `targets` (node ids or paths; every test when empty). */
export async function start(targets) {
  Object.assign(run, {
    active: true,
    startedAt: Date.now(),
    started: false,
    total: null,
    current: null,
    targets,
    tests: [],
    errors: [],
    output: '',
    command: '',
  });
  savedDuringRun = null;
  notify('start');
  let reply;
  try {
    reply = await invoke('tests_run', { targets });
  } catch (error) {
    return end({ problem: { kind: 'error', title: 'The tests could not start', detail: String(error) } });
  }
  if (reply?.problem) return end({ problem: reply.problem });
  if (run.active) run.command = reply?.command || '';
  notify('progress');
}

export function cancel() {
  if (run.active) invoke('tests_cancel');
}

function end(done) {
  const targets = run.targets;
  run.active = false;
  run.current = null;
  // A run that never reached pytest leaves the earlier results as they were.
  if (!done.problem || done.tests?.length || done.errors?.length) {
    results.tests = merge(results.tests, done.tests || [], targets);
    results.errors = merge(results.errors, done.errors || [], targets);
    const fresh = [...(done.tests || []), ...(done.errors || [])].map((test) => test.id);
    for (const id of fresh) savedDuringRun ? results.stale.add(id) : results.stale.delete(id);
    if (savedDuringRun) results.staleFile = savedDuringRun;
  }
  Object.assign(results, {
    ran: true,
    problem: done.problem || null,
    summary: done.summary || '',
    cancelled: Boolean(done.cancelled),
    targets,
    output: done.output ?? run.output,
    command: done.command || run.command,
  });
  notify('done');
  finished(done);
}

/** A file was saved: results that ran before it may no longer hold. */
export function markStale(path) {
  if (run.active) savedDuringRun = path;
  const all = [...results.tests, ...results.errors];
  if (!all.length) return;
  for (const test of all) results.stale.add(test.id);
  results.staleFile = path;
  notify('stale');
}

/** Forgets everything, for a newly opened folder. */
export function reset() {
  cancel();
  run.active = false;
  Object.assign(results, {
    ran: false,
    tests: [],
    errors: [],
    problem: null,
    summary: '',
    cancelled: false,
    targets: [],
    output: '',
    command: '',
    stale: new Set(),
    staleFile: null,
  });
  notify('reset');
}

/** The results to show now: during a run, the new ones so far in place of the ones being rerun. */
export function shownTests() {
  return run.active ? merge(results.tests, run.tests, run.targets) : results.tests;
}

export function shownErrors() {
  return run.active ? merge(results.errors, run.errors, run.targets) : results.errors;
}
