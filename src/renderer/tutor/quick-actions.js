// The buttons above the question box: explain the selection, review the file, and "I'm stuck".

import { h } from '../dom.js';
import { state } from '../state.js';
import { activeFile, save } from '../editor/index.js';
import { showStatus } from '../shell/index.js';
import { ask } from './conversation.js';
import { ladder, openLadder } from './hints.js';

export function explainSelection() {
  if (!state.workspace) return;
  if (!activeFile()?.selection) return showStatus('Select some code in the editor first');
  ask('Explain what the selected code does and why, line by line where it matters.', 'explain');
}

export async function reviewFile() {
  if (!state.workspace) return;
  if (!activeFile()) return showStatus('Open the file you want reviewed');
  await save();
  ask(`Review ${activeFile().path}, which I wrote. Give me observations and questions tied to line ranges. Do not rewrite it.`, 'review');
}

export const quickActions = h(
  'div',
  { id: 'quick' },
  h('button', { onclick: explainSelection, title: 'Explain the selected code (⌘E)' }, 'Explain selection'),
  h('button', { onclick: reviewFile, title: 'Observations on the open file (⇧⌘R)' }, 'Review this file'),
  h('button', { id: 'stuck', onclick: () => (ladder.hidden ? openLadder() : ladder.querySelector('.rung').focus()) }, "I'm stuck"),
);
