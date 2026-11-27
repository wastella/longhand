// The errors and warnings a language server reports, drawn where they are: a wavy underline with
// the message on hover (CodeMirror's lint marks) and the line's number in the same colour. They
// are the compiler's remarks, not the tutor's, and look nothing like the tutor's margin notes.
//
// Hints are left out. Servers use them for "this name is not used" and similar remarks, which
// editors grey out rather than underline; underlined, they would bury the real problems.

import { RangeSet, StateField } from '@codemirror/state';
import { GutterMarker, gutterLineClass } from '@codemirror/view';
import { diagnosticCount, forEachDiagnostic, setDiagnostics, setDiagnosticsEffect } from '@codemirror/lint';
import { fileState, updateFile } from '../editor/index.js';

/** The protocol's severities that are shown, most serious first. */
const SEVERITIES = { 1: 'error', 2: 'warning', 3: 'info' };
const RANK = { error: 0, warning: 1, info: 2 };

let onChange = () => {};

/** Calls `handler(path)` whenever the problems shown in a file change. */
export const watchProblems = (handler) => (onChange = handler);

/** Where a protocol position (zero-based line, UTF-16 column) is in `doc`, kept inside it. */
export function offsetOf(doc, position) {
  if (position.line >= doc.lines) return doc.length;
  const line = doc.line(position.line + 1);
  return Math.min(line.from + position.character, line.to);
}

class LineMark extends GutterMarker {
  constructor(severity) {
    super();
    this.elementClass = `cm-problem-line cm-problem-line-${severity}`;
  }
}
const lineMarks = { error: new LineMark('error'), warning: new LineMark('warning') };

/** One mark per line an error or warning starts on, the more serious winning. */
function markLines(doc, problems) {
  const worst = new Map();
  for (const { from, severity } of problems) {
    if (!lineMarks[severity]) continue;
    const line = doc.lineAt(Math.min(from, doc.length)).from;
    if (!worst.has(line) || RANK[severity] < RANK[worst.get(line)]) worst.set(line, severity);
  }
  return RangeSet.of([...worst].sort((a, b) => a[0] - b[0]).map(([line, severity]) => lineMarks[severity].range(line)));
}

/** Colours the line numbers of lines with problems; part of a served file's extension. */
export const problemLines = StateField.define({
  create: () => RangeSet.empty,
  update(marks, tr) {
    const shown = tr.effects.find((effect) => effect.is(setDiagnosticsEffect));
    if (shown) return markLines(tr.state.doc, shown.value);
    return tr.docChanged ? marks.map(tr.changes) : marks;
  },
  provide: (field) => gutterLineClass.from(field),
});

/**
 * Shows what the server reported for one file (the protocol's publishDiagnostics). A report
 * about an older text than the server now has is dropped, as a newer one follows; positions
 * are moved past whatever the student typed since the server last heard.
 */
export function showProblems(documents, { uri, version, diagnostics }) {
  const file = documents.getFile(uri);
  const state = file && fileState(file.path);
  if (!state || (version != null && version !== file.version)) return;
  const unsent = file.unsent();
  const problems = [];
  for (const item of diagnostics || []) {
    const severity = SEVERITIES[item.severity ?? 1];
    if (!severity || !item.range) continue;
    let from = offsetOf(file.doc, item.range.start);
    let to = offsetOf(file.doc, item.range.end);
    if (unsent) [from, to] = [unsent.mapPos(from, 1), unsent.mapPos(to, -1)];
    problems.push({ from, to: Math.max(from, to), severity, message: String(item.message ?? '') });
  }
  updateFile(file.path, setDiagnostics(state, problems));
  onChange(file.path);
}

/** Removes the problems shown in `path`, for when its server is gone. */
export function clearProblems(path) {
  const state = fileState(path);
  if (!state || !diagnosticCount(state)) return;
  updateFile(path, setDiagnostics(state, []));
  onChange(path);
}

/** How many problems `state` shows: { errors, warnings }. */
export function countProblems(state) {
  const counts = { errors: 0, warnings: 0 };
  forEachDiagnostic(state, ({ severity }) => {
    if (severity === 'error') counts.errors += 1;
    else if (severity === 'warning') counts.warnings += 1;
  });
  return counts;
}

/** The most serious problem at `pos` in `state`: { severity, message }, or null. */
export function problemAt(state, pos) {
  let found = null;
  forEachDiagnostic(state, (problem, from, to) => {
    if (pos >= from && pos <= to && (!found || RANK[problem.severity] < RANK[found.severity])) found = problem;
  });
  return found;
}
