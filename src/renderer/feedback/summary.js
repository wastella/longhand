// The Notes list at the top of the tutor panel, for the file in the editor: the review running
// (with Stop) or how it ended, each open note with a jump to it, the resolved ones out of the way,
// notes whose code is gone, and Review again. It shows only when the file has notes or a review.

import { h, spacer } from '../dom.js';
import { on } from '../state.js';
import { activeFile } from '../editor/index.js';
import { icon, runCommand } from '../shell/index.js';
import { failureView } from '../tutor/index.js';
import { describe, dismiss, gistOf, jumpTo, notesOnFile, reopen, watchNotes } from './notes.js';
import { NOTE_KINDS } from './review-format.js';
import { clearReview, retryReview, review, stopReview, watchReview } from './review.js';

export const summary = h('section', { id: 'fb-summary', 'aria-label': 'Notes on this file', hidden: true });
/** Which folded groups the student opened: 'resolved', 'outdated'. */
const unfolded = new Set();
/** Outdated notes the student expanded to read in full. */
const expanded = new Set();

const lines = ({ fromLine, toLine }) => (fromLine === toLine ? `${fromLine}` : `${fromLine}–${toLine}`);

function row(record, { onclick, title, action, open = null }) {
  return h(
    'div',
    { class: `fb-row${open ? ' expanded' : ''}`, role: 'listitem' },
    h(
      'button',
      { type: 'button', class: `list-row fb-row-main ${record.kind}`, title, onclick, 'aria-expanded': open === null ? null : String(open) },
      h('span', { class: 'fb-row-lines' }, lines(record)),
      h('span', { class: 'fb-row-kind' }, NOTE_KINDS[record.kind]),
      h('span', { class: 'fb-row-text' }, gistOf(record)),
    ),
    action,
  );
}

/** A button that runs a note command, with its shortcut in the tooltip. */
const step = (command, label, name) =>
  h(
    'button',
    {
      type: 'button',
      class: 'button small ghost icon-button',
      'aria-label': label,
      'data-tip': label,
      'data-tip-command': command,
      onclick: () => runCommand(command),
    },
    icon(name, 'small'),
  );

function group(name, title, rows) {
  if (!rows.length) return null;
  const details = h('details', { class: `fb-group ${name}`, open: unfolded.has(name) }, h('summary', {}, title), rows);
  details.addEventListener('toggle', () => (details.open ? unfolded.add(name) : unfolded.delete(name)));
  return details;
}

function status(path) {
  if (review?.path !== path) return null;
  const close = h('button', { type: 'button', class: 'button small ghost fb-action', onclick: clearReview }, 'OK');
  if (review.status === 'running') {
    const doing = review.reading ? `Reading ${review.reading}…` : 'Reading your code…';
    const soFar = review.placed ? ` ${review.placed} so far.` : '';
    return h(
      'div',
      { class: 'fb-status running', role: 'status' },
      h('span', {}, doing + soFar),
      spacer(),
      h('button', { type: 'button', class: 'button small ghost fb-action', onclick: stopReview }, 'Stop'),
    );
  }
  if (review.status === 'error') return h('div', { class: 'fb-status' }, failureView(review.error, retryReview));
  if (review.status === 'empty')
    return h(
      'div',
      { class: 'fb-status', role: 'status' },
      h('span', {}, 'The review came back without notes the editor could place.'),
      spacer(),
      h('button', { type: 'button', class: 'button small ghost fb-action', onclick: retryReview }, 'Retry'),
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
      h('h2', { class: 'section-label' }, 'Notes'),
      count && h('span', { class: 'fb-summary-count' }, count),
      spacer(),
      open.length > 1 && step('previous-note', 'Previous note', 'chevron-left'),
      open.length > 1 && step('next-note', 'Next note', 'chevron-right'),
      !running &&
        h(
          'button',
          {
            type: 'button',
            class: 'button small ghost',
            id: 'fb-review-again',
            'data-tip': 'New notes replace the open ones you have not replied to; notes with replies and resolved notes stay',
            'data-tip-command': 'review-file',
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
          title: expanded.has(r.id) ? 'Show less' : 'The lines this note was about have changed or gone. Show the whole note',
          open: expanded.has(r.id),
          onclick: () => {
            if (!expanded.delete(r.id)) expanded.add(r.id);
            render();
          },
          action: h(
            'button',
            { type: 'button', class: 'button small ghost fb-action', 'aria-label': `Dismiss the note on ${describe(r)}`, onclick: () => dismiss(r.id) },
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
