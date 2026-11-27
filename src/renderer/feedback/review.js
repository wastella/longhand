// "Review this file": the tutor reads the saved file and answers with a few margin notes, which
// are placed one by one as each arrives. Only the student starts a review. A new review of a file
// replaces its open notes once the first new note arrives, so a review that fails or is stopped
// before then leaves the old ones where they were; resolved notes are never touched.

import { activeFile, save } from '../editor/index.js';
import { on, state } from '../state.js';
import { formatKeys, isPanelShown, notify, showPanel, showStatus } from '../shell/index.js';
import { failureText, tutorRequest } from '../tutor/index.js';
import { addReviewNote, clearOpenNotes, newId } from './notes.js';
import { parseReview, reviewPrompt, tooLong } from './review-format.js';
import { readLines } from './source.js';

/**
 * The review in progress or just ended, for the Notes list:
 * { path, status: 'running' | 'error' | 'empty' | 'stopped' | 'done', placed, error?, reading? } or null.
 */
export let review = null;
let handle = null;
const watchers = new Set();
export const watchReview = (watch) => watchers.add(watch);
const changed = () => watchers.forEach((watch) => watch());

const fileName = (path) => path.split('/').pop();
const plural = (n) => `${n} ${n === 1 ? 'note' : 'notes'}`;

/** Reviews the file in the editor, saving it first. */
export async function reviewFile() {
  if (!state.workspace) return;
  const file = activeFile();
  if (!file) return showStatus('Open the file you want reviewed');
  if (review?.status === 'running') return showStatus(`Already reviewing ${fileName(review.path)}`);
  const { path } = file;
  if (!(await save(path)) && activeFile()?.dirty)
    return notify({ kind: 'error', message: `${fileName(path)} could not be saved, so it was not reviewed. The editor says why.` });
  const lines = await readLines(path);
  if (!lines) return notify({ kind: 'error', message: `${fileName(path)} could not be read for a review.` });
  const why = tooLong(lines);
  if (why) return notify({ message: `${fileName(path)} is too long to review: ${why}. Select the part you want and use Explain.` });
  run(path, lines);
}

function run(path, lines) {
  review = { path, status: 'running', placed: 0, reading: null };
  changed();
  showStatus(`Reviewing ${fileName(path)}: notes will appear in the margin`, 6000);
  const mine = review;
  const place = (text) => {
    const notes = parseReview(text, lines.length);
    if (!notes.length || mine !== review) return;
    if (!mine.placed) clearOpenNotes(path);
    for (const note of notes.slice(mine.placed)) addReviewNote(path, lines, note);
    mine.placed = notes.length;
    changed();
  };
  handle = tutorRequest({
    thread: newId('review-'),
    kind: 'review',
    prompt: reviewPrompt(path, lines),
    question: `Review ${path}`,
    context: [path],
    about: 'review',
    ephemeral: true,
    onText: place,
    onActivity: ({ target }) => {
      mine.reading = String(target || '').replace(`${state.workspace?.path}/`, '');
      changed();
    },
  });
  handle.done.then((result) => {
    if (mine !== review) return;
    handle = null;
    place(result.text);
    if (result.status === 'error') Object.assign(mine, { status: 'error', error: result.error });
    else if (result.status === 'cancelled') mine.status = mine.placed ? 'done' : 'stopped';
    else mine.status = mine.placed ? 'done' : 'empty';
    if (mine.status === 'done' && mine.placed)
      showStatus(`${plural(mine.placed)} on ${fileName(path)}. ${formatKeys('CmdOrCtrl+Alt+]')} goes through them.`, 6000);
    // The Notes list says what went wrong; when it is out of sight, so does a notification.
    if (mine.status === 'error' && !isPanelShown('tutor'))
      notify({
        kind: 'error',
        message: `The review of ${fileName(path)} failed: ${failureText(result.error)}`,
        action: { label: 'Show', run: () => showPanel('tutor') },
      });
    changed();
  });
}

/** Stops the review in progress; the notes placed so far stay. */
export const stopReview = () => handle?.cancel();

/** Runs the last review again, after an error. */
export async function retryReview() {
  if (!review || review.status === 'running') return;
  const lines = await readLines(review.path);
  if (lines) run(review.path, lines);
}

/** Forgets how the last review ended (its message has been seen). */
export function clearReview() {
  if (review?.status === 'running') return;
  review = null;
  changed();
}

export function setupReview() {
  on('workspace:opened', () => {
    stopReview();
    review = null;
    changed();
  });
}
