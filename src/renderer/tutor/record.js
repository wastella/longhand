// "Your record": the student's own use of the tutor in this folder, by day. A mirror, not a
// score: plain counts, no streaks, no targets, no judgement.

import { emptyState, h } from '../dom.js';
import { usageRecord } from './engine.js';

const KINDS = [
  ['question', 'question', 'questions'],
  ['explain', 'explanation', 'explanations'],
  ['review', 'review', 'reviews'],
  ['failure', 'test failure', 'test failures'],
  ['hint', 'hint', 'hints'],
  ['lookup', 'lookup', 'lookups'],
];
const RUNG_NAMES = ['', 'orientation', 'key idea', 'similar example'];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** One day's (or all days') use as a short line of counts. */
export function describe(tally) {
  const parts = KINDS.filter(([key]) => tally.asks[key]).map(([key, one, many]) => plural(tally.asks[key], one, many));
  const known = new Set(KINDS.map(([key]) => key));
  const other = Object.entries(tally.asks)
    .filter(([key]) => !known.has(key))
    .reduce((sum, [, n]) => sum + n, 0);
  if (other) parts.push(plural(other, 'other question', 'other questions'));
  if (tally.hintRung) parts.push(`hints up to step ${tally.hintRung} (${RUNG_NAMES[tally.hintRung] || 'beyond'})`);
  if (tally.reveals) parts.push(plural(tally.reveals, 'code reveal', 'code reveals'));
  return parts.join(' · ') || 'No tutor use';
}

function dayName(date, now = new Date()) {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  if (day.toDateString() === now.toDateString()) return 'Today';
  return day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: y === now.getFullYear() ? undefined : 'numeric' });
}

const body = h('div', { id: 'record-body' });
export const recordView = h(
  'div',
  { id: 'record', class: 'tutor-view', hidden: true },
  h('p', { class: 'record-intro' }, 'Your own use of the tutor in this folder, kept in .longhand/log.jsonl on this computer.'),
  body,
);

export async function showRecord() {
  const record = await usageRecord();
  if (!record.days.length) return body.replaceChildren(emptyState('Nothing yet. Questions, hints and code reveals appear here by day.'));
  body.replaceChildren(
    h('div', { class: 'record-day total' }, h('div', { class: 'record-date' }, 'All days'), h('div', {}, describe(record.total))),
    ...record.days.map((day) => h('div', { class: 'record-day' }, h('div', { class: 'record-date' }, dayName(day.date)), h('div', {}, describe(day)))),
  );
}
