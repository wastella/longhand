// Starting and stopping runs, and what is known about the current run and the latest results.

import { invoke, listen } from '../backend.js';
import { goneAfter, merge, mergeRun } from './model.js';

/** Raw output kept in the interface while a run goes; the backend keeps the same amount. */
const OUTPUT_LIMIT = 2_000_000;

/** The run in progress. */
export const run = {
  active: false,
  /** This run's id, sent to the backend and back in each of its events. */
  token: null,
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
  /** The last run reached its end with a result for everything it set out to run. */
  complete: false,
  targets: [],
  output: '',
  command: '',
  /** Ids of results that ran before a file was saved, and the last file saved. */
  stale: new Set(),
  staleFile: null,
  /** Ids of results kept from an earlier run because the last run stopped before them. */
  unreached: new Set(),
};

let notify = () => {};
let finished = () => {};
let savedDuringRun = null;
let runs = 0;

const mine = (payload) => run.active && payload?.run === run.token;

/** Puts a result in, replacing an earlier one for the same test (a rerun, a late failure). */
function upsert(list, test) {
  const i = list.findIndex((other) => other.id === test.id);
  if (i < 0) list.push(test);
  else list[i] = test;
}

/** Starts listening to the backend. `onChange(what)` follows every change; `onDone(done)` each finished run. */
export function connect({ onChange, onDone }) {
  notify = onChange;
  finished = onDone;
  listen('tests:output', (payload) => {
    if (!mine(payload)) return;
    run.output = (run.output + payload.text).slice(-OUTPUT_LIMIT);
    notify('output');
  });
  listen('tests:progress', (payload) => {
    if (!mine(payload)) return;
    for (const update of payload.updates) {
      if (update.type === 'started') run.started = true;
      else if (update.type === 'collected') run.total = update.total;
      else if (update.type === 'running') run.current = update.id;
      else if (update.type === 'result') upsert(run.tests, update.test);
      else if (update.type === 'collect-error') upsert(run.errors, update.test);
    }
    notify('progress');
  });
  listen('tests:done', (done) => mine(done) && end(done));
}

/** Runs `targets` (node ids or paths; every test when empty). */
export async function start(targets) {
  const token = `run-${Date.now()}-${++runs}`;
  Object.assign(run, {
    active: true,
    token,
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
    reply = await invoke('tests_run', { targets, run: token });
  } catch (error) {
    if (run.token === token && run.active) end({ problem: { kind: 'error', title: 'The tests could not start', detail: String(error) } });
    return;
  }
  if (run.token !== token || !run.active) return;
  if (reply?.problem) return end({ ...reply, targets });
  run.command = reply?.command || '';
  notify('progress');
}

/** Stops the run. The backend says nothing more about it, so it ends here, with what it got. */
export function cancel() {
  if (!run.active) return;
  invoke('tests_cancel');
  const seconds = (Date.now() - run.startedAt) / 1000;
  end({ cancelled: true, complete: false, tests: run.tests, errors: run.errors, summary: `stopped in ${seconds.toFixed(2)}s`, output: run.output });
}

function end(done) {
  const targets = run.targets;
  run.active = false;
  run.token = null;
  run.current = null;
  const fresh = [...(done.tests || []), ...(done.errors || [])];
  // A run that never reached pytest leaves the earlier results as they were.
  const reached = Boolean(fresh.length || done.collected || done.cancelled);
  if (reached) {
    const gone = goneAfter(done);
    const tests = mergeRun(results.tests, done.tests || [], targets, gone.test);
    const errors = mergeRun(results.errors, done.errors || [], targets, gone.error);
    results.tests = tests.tests;
    results.errors = errors.tests;
    for (const test of fresh) {
      results.unreached.delete(test.id);
      savedDuringRun ? results.stale.add(test.id) : results.stale.delete(test.id);
    }
    for (const id of [...tests.unreached, ...errors.unreached]) results.unreached.add(id);
    const present = new Set([...results.tests, ...results.errors].map((test) => test.id));
    for (const id of results.unreached) if (!present.has(id)) results.unreached.delete(id);
    for (const id of results.stale) if (!present.has(id)) results.stale.delete(id);
    if (savedDuringRun) results.staleFile = savedDuringRun;
  }
  Object.assign(results, {
    ran: true,
    problem: done.problem || null,
    summary: reached || !done.refused ? done.summary || '' : results.summary,
    cancelled: Boolean(done.cancelled),
    complete: reached ? Boolean(done.complete) : results.complete,
    targets,
    output: done.output ?? run.output,
    command: done.command || run.command,
  });
  notify('done');
  finished(done);
}

/**
 * A file was saved (`how` 'saved') or changed on disk outside the editor ('changed'; `path` ''
 * when it could be anything): results that ran before it may no longer hold.
 */
export function markStale(path, how = 'saved') {
  if (run.active) savedDuringRun = { path, how };
  const all = [...results.tests, ...results.errors];
  if (!all.length) return;
  for (const test of all) results.stale.add(test.id);
  results.staleFile = { path, how };
  notify('stale');
}

/** A run that was asked for but not started, for `problem`; the earlier results stay as they were. */
export function refuse(targets, problem) {
  if (run.active) return;
  Object.assign(run, { targets, output: '', command: '' });
  end({ problem, refused: true });
}

/** Forgets everything, for a newly opened folder. The backend has stopped the run already. */
export function reset() {
  Object.assign(run, { active: false, token: null, current: null });
  Object.assign(results, {
    ran: false,
    tests: [],
    errors: [],
    problem: null,
    summary: '',
    cancelled: false,
    complete: false,
    targets: [],
    output: '',
    command: '',
    stale: new Set(),
    staleFile: null,
    unreached: new Set(),
  });
  notify('reset');
}

/** Whether a result may no longer hold: it ran before a save, or the last run did not reach it. */
export const isStale = (id) => results.stale.has(id) || results.unreached.has(id);

/** During a run, the earlier results it has yet to replace. */
export function awaiting() {
  if (!run.active) return new Set();
  const tests = mergeRun(results.tests, run.tests, run.targets).unreached;
  const errors = mergeRun(results.errors, run.errors, run.targets).unreached;
  return new Set([...tests, ...errors]);
}

/** The results to show now: during a run, the new ones so far in place of the ones being rerun. */
export function shownTests() {
  return run.active ? merge(results.tests, run.tests, run.targets) : results.tests;
}

export function shownErrors() {
  return run.active ? merge(results.errors, run.errors, run.targets) : results.errors;
}
