// The buttons above the question box: explain the selection and review the file (both answered
// in the margin, see feedback/), and "I'm stuck".

import { h } from '../dom.js';
import { runCommand } from '../shell/index.js';
import { ladder, openLadder } from './hints.js';

export const quickActions = h(
  'div',
  { id: 'quick' },
  h('button', { onclick: () => runCommand('ask-selection'), title: 'Explain the selected code, in a note beside it (⌘E)' }, 'Explain selection'),
  h('button', { onclick: () => runCommand('review-file'), title: 'Notes in the margin of the open file (⇧⌘R)' }, 'Review this file'),
  h('button', { id: 'stuck', onclick: () => (ladder.hidden ? openLadder() : ladder.querySelector('.rung').focus()) }, "I'm stuck"),
);
