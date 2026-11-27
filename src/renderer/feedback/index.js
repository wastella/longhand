// Feedback: the tutor's help pinned to the student's work instead of the side panel. Reviews
// become notes in the margin (notes.js, review.js), "Explain" and "Ask about this…" answer in a
// note on the selection (explain.js), and help on a failing test sits beneath the test
// (failure.js). Every request starts from something the student did. Other areas import from
// this file only.

import { registerCommand } from '../shell/index.js';
import { panelStrip } from '../tutor/index.js';
import { explainSelection, setupExplain } from './explain.js';
import { setupFailureHelp } from './failure.js';
import { setupNotes } from './notes.js';
import { reviewFile, setupReview } from './review.js';
import { setupSummary, summary } from './summary.js';

export function mount() {
  panelStrip.append(summary);
  setupNotes();
  setupReview();
  setupSummary();
  setupExplain();
  const unregisterFailurePanel = setupFailureHelp();
  registerCommand('review-file', reviewFile);
  registerCommand('ask-selection', explainSelection);
  // The tests area's preview of its failure-panel hook puts a stand-in in place of this one.
  if (window.__MOCK__) window.__feedback = { unregisterFailurePanel };
}
