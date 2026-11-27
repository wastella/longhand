// Test results as data: reading pytest node ids, merging runs, grouping and counting.
// A result is the backend's test object: { id, status, duration, path, line, message, detail,
// phase, frames, at, sections }; see src-tauri/src/pytest/report.rs.

export const failed = (test) => test.status === 'FAILED' || test.status === 'ERROR';

/**
 * Splits a node id into its file, enclosing classes, function and parameters:
 * "tests/test_m.py::TestA::test_b[x::y]" → { file, classes: ['TestA'], func: 'test_b', params: '[x::y]' }.
 * Parameters may themselves contain "::", so only the part before the first "[" is split.
 */
export function parseId(id) {
  const bracket = id.indexOf('[');
  const head = bracket < 0 ? id : id.slice(0, bracket);
  const params = bracket < 0 ? '' : id.slice(bracket);
  const [file, ...names] = head.split('::');
  return { file, classes: names.slice(0, -1), func: names.at(-1) || '', params };
}

/** The test's name without its file, as a student would say it: "TestA › test_b[1]". */
export function shortName(test) {
  const { classes, func, params } = parseId(test.id);
  if (test.phase === 'collect') return 'Could not be imported';
  return [...classes, func + params].join(' › ');
}

/** Whether `id` (a test, or a file for a collection error) is part of a run of `targets`. */
export function inScope(id, targets) {
  if (!targets.length) return true;
  const file = parseId(id).file;
  return targets.some(
    (target) => id === target || id.startsWith(`${target}::`) || id.startsWith(`${target}[`) || file === target || file.startsWith(`${target}/`),
  );
}

/** The results after a run of `targets` reported `fresh`: earlier results outside the run stay. */
export function merge(previous, fresh, targets) {
  const byId = new Map(fresh.map((test) => [test.id, test]));
  // Each test keeps its place, so a rerun does not shuffle the list; new ones join their file.
  const merged = previous.flatMap((test) => (byId.has(test.id) ? [byId.get(test.id)] : inScope(test.id, targets) ? [] : [test]));
  const placed = new Set(merged.map((test) => test.id));
  for (const test of fresh) {
    if (placed.has(test.id)) continue;
    const file = parseId(test.id).file;
    const last = merged.findLastIndex((other) => parseId(other.id).file === file);
    merged.splice(last < 0 ? merged.length : last + 1, 0, test);
  }
  return merged;
}

/** How many tests have each outcome. */
export function count(tests) {
  const counts = { failed: 0, passed: 0, skipped: 0, xfailed: 0, xpassed: 0, errors: 0, total: tests.length };
  const key = { FAILED: 'failed', PASSED: 'passed', SKIPPED: 'skipped', XFAIL: 'xfailed', XPASS: 'xpassed', ERROR: 'errors' };
  for (const test of tests) if (key[test.status]) counts[key[test.status]]++;
  return counts;
}

const failing = (item) => (item.tests || [item]).some(failed);
const failuresFirst = (items) => [...items.filter(failing), ...items.filter((item) => !failing(item))];

/**
 * Arranges results for the list: one group per file, failing files first; inside each, the
 * tests in file order with failing ones first, and the cases of a parameterised test gathered
 * under their function.
 *   [{ key, label, tests, items: [test | { key, label, tests, items: [test] }] }]
 */
export function group(tests) {
  const files = new Map();
  for (const test of tests) {
    const { file, classes, func } = parseId(test.id);
    if (!files.has(file)) files.set(file, new Map());
    const fn = [file, ...classes, func].join('::');
    const functions = files.get(file);
    if (!functions.has(fn)) functions.set(fn, []);
    functions.get(fn).push(test);
  }
  const groups = [...files].map(([file, functions]) => {
    const items = [...functions].map(([key, cases]) => {
      if (cases.length === 1) return cases[0];
      const { classes, func } = parseId(cases[0].id);
      return { key, label: [...classes, func].join(' › '), tests: cases, items: failuresFirst(cases) };
    });
    return { key: file, label: file, tests: [...functions.values()].flat(), items: failuresFirst(items) };
  });
  return failuresFirst(groups);
}

/** "0.42s", "12s", "2m 05s"; null for durations too short to mention. */
export function duration(seconds) {
  if (!(seconds >= 0.1)) return null;
  if (seconds < 10) return `${seconds.toFixed(2)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** A clock for elapsed time: "0:07", "12:30". */
export function clock(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A test is slow when it takes a second or more; slow tests are shown brighter. */
export const slow = (test) => test.duration >= 1;
