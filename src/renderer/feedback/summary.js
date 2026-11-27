// The Notes list at the top of the tutor panel, for the file in the editor: the review running
// (with Stop) or how it ended, each open note with a jump to it, the resolved ones out of the way,
// notes whose code is gone, and Review again. It shows only when the file has notes or a review.

import { h, spacer } from '../dom.js';
import { on } from '../state.js';
import { activeFile } from '../editor/index.js';
import { runCommand } from '../shell/index.js';
import { failureView } from '../tutor/index.js';
import { dismiss, jumpTo, notesOnFile, reopen, watchNotes } from './notes.js';
import { NOTE_KINDS } from './review-format.js';
import { clearReview, retryReview, review, stopReview, watchReview } from './review.js';

export const summary = h('section', { id: 'fb-summary', 'aria-label': 'Notes on this file', hidden: true });
/** Which folded groups the student opened: 'resolved', 'outdated'. */
const unfolded = new Set();

const lines = ({ fromLine, toLine }) => (fromLine === toLine ? `${fromLine}` : `${fromLine}–${toLine}`);
/** A note's text as one plain line, for the list. */
const gist = (text) =>
  text
    .replace(/```[\s\S]*?```/g, ' … ')
    .replace(/[`*$#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function row(record, { onclick, title, action }) {
  return h(
    'div',
    { class: 'fb-row', role: 'listitem' },
    h(
      onclick ? 'button' : 'div',
      { type: onclick ? 'button' : null, class: `list-row fb-row-main ${record.kind}`, title, onclick },
      h('span', { class: 'fb-row-lines' }, lines(record)),
      h('span', { class: 'fb-row-kind' }, NOTE_KINDS[record.kind]),
      h('span', { class: 'fb-row-text' }, gist(record.text)),
    ),
    action,
  );
}

function group(name, title, rows) {
  if (!rows.length) return null;
  const details = h('details', { class: `fb-group ${name}`, open: unfolded.has(name) }, h('summary', {}, title), rows);
  details.addEventListener('toggle', () => (details.open ? unfolded.add(name) : unfolded.delete(name)));
  return details;
}

function status(path) {
  if (review?.path !== path) return null;
  const close = h('button', { type: 'button', class: 'ghost fb-action', onclick: clearReview }, 'OK');
  if (review.status === 'running') {
    const doing = review.reading ? `Reading ${review.reading}…` : 'Reading your code…';
    const soFar = review.placed ? ` ${review.placed} so far.` : '';
    return h(
      'div',
      { class: 'fb-status running', role: 'status' },
      h('span', {}, doing + soFar),
      spacer(),
      h('button', { type: 'button', class: 'ghost fb-action', onclick: stopReview }, 'Stop'),
    );
  }
  if (review.status === 'error') return h('div', { class: 'fb-status' }, failureView(review.error, retryReview));
  if (review.status === 'empty')
    return h(
      'div',
      { class: 'fb-status', role: 'status' },
      h('span', {}, 'The review came back without notes the editor could place.'),
      spacer(),
      h('button', { type: 'button', class: 'ghost fb-action', onclick: retryReview }, 'Retry'),
      close,
    );
  if (review.status === 'stopped') return h('div', { class: 'fb-status', role: 'status' }, h('span', {}, 'Review stopped.'), spacer(), close);
  return null;
}

function render() {
  const path = activeFile()?.path;
  const { open, resolved, outdated } = path ? notesOnFile(path) : { open: [], resolved: [], outdated: [] };
  const state = path && status(path);
  summary.hidden = !path || (!state && !open.length && !resolved.length && !outdated.length);
  if (summary.hidden) return summary.replaceChildren();
  const running = review?.path === path && review.status === 'running';
  const count = open.length ? `${open.length} open` : resolved.length ? 'all resolved' : '';
  const parts = [
    h(
      'div',
      { class: 'fb-summary-head' },
      h('span', { class: 'fb-summary-title' }, 'Notes'),
      count && h('span', { class: 'fb-summary-count' }, count),
      spacer(),
      open.length > 1 &&
        h(
          'button',
          { type: 'button', class: 'ghost fb-step', title: 'Previous note (⌥⌘[)', 'aria-label': 'Previous note', onclick: () => runCommand('previous-note') },
          '‹',
        ),
      open.length > 1 &&
        h(
          'button',
          { type: 'button', class: 'ghost fb-step', title: 'Next note (⌥⌘])', 'aria-label': 'Next note', onclick: () => runCommand('next-note') },
          '›',
        ),
      !running &&
        h(
          'button',
          {
            type: 'button',
            class: 'ghost',
            id: 'fb-review-again',
            title: 'Review the file again: new notes replace the open ones (⇧⌘R)',
            onclick: () => runCommand('review-file'),
          },
          open.length || resolved.length || outdated.length ? 'Review again' : 'Review',
        ),
    ),
    state,
    open.length
      ? h(
          'div',
          { class: 'fb-list', role: 'list' },
          open.map((r) => row(r, { title: 'Show this note', onclick: () => jumpTo(r.id) })),
        )
      : null,
    group(
      'resolved',
      `${resolved.length} resolved`,
      resolved.map((r) => row(r, { title: 'Reopen this note in the margin', onclick: () => reopen(r.id) })),
    ),
    group(
      'outdated',
      outdated.length === 1 ? '1 note no longer matches the code' : `${outdated.length} notes no longer match the code`,
      outdated.map((r) =>
        row(r, {
          title: 'The lines this note was about have changed or gone',
          onclick: null,
          action: h(
            'button',
            { type: 'button', class: 'ghost fb-action', 'aria-label': `Dismiss the note on line ${lines(r)}`, onclick: () => dismiss(r.id) },
            'Dismiss',
          ),
        }),
      ),
    ),
  ];
  summary.replaceChildren(...parts.filter(Boolean));
}

export function setupSummary() {
  watchNotes(render);
  watchReview(render);
  on('editor:active', render);
  render();
}
