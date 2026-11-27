// The tutor panel: policy, conversation, setup steps, quick actions and the question box.

import { invoke, listen } from '../backend.js';
import { h, paneHead, spacer } from '../dom.js';
import { on, state } from '../state.js';
import { registerCommand, showPanel, showStatus } from '../shell/index.js';
import { chat, clearChat, newConversation, onTutorEvent, setupChat } from './chat.js';
import { attach, form, input, showCursor, stopButton } from './composer.js';
import { quickActions, explainSelection, reviewFile } from './quick-actions.js';
import { isConnected, setupBox, showSetup } from './setup.js';

export { ask } from './chat.js';
export { renderAnswer } from './markdown.js';

/**
 * Opens the tutor with `attachment` ({ kind, label, text, placeholder }) attached to the next
 * question, so the student writes the question themselves.
 */
export function askTutorAbout(attachment) {
  showPanel('tutor');
  attach(attachment);
}

const policy = h(
  'select',
  { id: 'policy', title: 'How much code the tutor may show' },
  h('option', { value: 'strict' }, 'Strict: no code'),
  h('option', { value: 'guided' }, 'Guided: toy examples'),
);
const courseNote = h('div', { id: 'course-note', hidden: true });

async function changePolicy() {
  state.config = await invoke('config_set', { patch: { policy: policy.value } });
  await newConversation();
  showStatus(`Tutor policy set to ${state.config.policy}; started a new conversation`);
}

function showFolder(ws) {
  policy.value = ws.config.policy;
  courseNote.hidden = !ws.courseRules;
  courseNote.textContent = ws.courseRules ? `Following this course's rules for AI (${ws.courseRules}).` : '';
  clearChat();
}

function showConnection(auth) {
  const ready = isConnected(auth);
  showSetup(auth);
  quickActions.hidden = !ready;
  form.hidden = !ready;
}

export function mount(region) {
  const newChat = h('button', { id: 'new-chat', class: 'ghost', title: 'New conversation', onclick: newConversation }, 'New');
  region.append(paneHead(h('span', {}, 'Tutor'), spacer(), policy, newChat), courseNote, chat, setupBox, quickActions, form);
  setupChat();
  policy.onchange = changePolicy;
  stopButton.onclick = () => invoke('tutor_cancel');

  registerCommand('ask-selection', explainSelection);
  registerCommand('review-file', reviewFile);
  registerCommand('new-conversation', newConversation);
  listen('tutor:event', onTutorEvent);
  on('workspace:opened', showFolder);
  on('auth:changed', showConnection);
  on('editor:cursor', showCursor);
  on('panel:toggled', ({ id, visible }) => id === 'tutor' && visible && input.focus());
}
