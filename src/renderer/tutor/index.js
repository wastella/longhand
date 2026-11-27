// The tutor panel: policy, conversation, earlier conversations, the student's record, setup
// steps, hints, quick actions and the question box; and the lookup bar. Other areas import from
// this file only.

import { invoke } from '../backend.js';
import { h, paneHead, spacer } from '../dom.js';
import { emit, on, state } from '../state.js';
import { registerCommand, registerFocusTarget, showStatus } from '../shell/index.js';
import { form, input, renderChips, showCursor } from './composer.js';
import { chat, newConversation, resumeLatest, setupConversation } from './conversation.js';
import { closeLadder, ladder } from './hints.js';
import { historyView, showHistory } from './history.js';
import { openLookup, setupLookup } from './lookup.js';
import { loadMathStyles } from './math.js';
import { quickActions } from './quick-actions.js';
import { recordView, showRecord } from './record.js';
import { isConnected, setupBox, showSetup } from './setup.js';

export { tutorRequest, prepareTutor, listThreads, loadThread, usageRecord } from './engine.js';
export { ask } from './conversation.js';
export { renderAnswer } from './markdown.js';
export { hideCodeAcross } from './hidden-code.js';
export { failureText, failureView } from './errors.js';

/** A place at the top of the panel, under the policy, for the Notes list on the open file (feedback/). */
export const panelStrip = h('div', { id: 'tutor-strip' });

const POLICIES = {
  strict: { label: 'Strict', note: 'Strict: the tutor writes no code, only prose, math and shapes.' },
  guided: { label: 'Guided', note: 'Guided: the tutor may show short toy examples, never your assignment.' },
};

const policyButtons = Object.entries(POLICIES).map(([value, { label, note }]) =>
  h('button', { type: 'button', 'data-policy': value, 'aria-pressed': 'false', title: note, onclick: () => changePolicy(value) }, label),
);
const policy = h('div', { id: 'policy', class: 'segmented', role: 'group', 'aria-label': 'How much code the tutor may show' }, policyButtons);
const policyNote = h('div', { id: 'course-note' });

function showPolicy() {
  for (const button of policyButtons) button.setAttribute('aria-pressed', String(button.dataset.policy === state.config.policy));
  const course = state.workspace?.courseRules ? ` Following this course's rules for AI (${state.workspace.courseRules}).` : '';
  policyNote.textContent = (POLICIES[state.config.policy] || POLICIES.strict).note + course;
}

async function changePolicy(value) {
  if (!state.workspace || value === state.config.policy) return;
  state.config = await invoke('config_set', { patch: { policy: value } });
  emit('config:changed', state.config);
  showPolicy();
  newConversation();
  showStatus(`Tutor policy set to ${POLICIES[value].label}; started a new conversation`);
}

// The panel shows the conversation, the list of earlier ones, or the student's record.
const views = { history: historyView, record: recordView };
const viewButtons = {
  history: h('button', { class: 'ghost', id: 'show-history', 'aria-pressed': 'false', title: 'Earlier conversations in this folder' }, 'History'),
  record: h('button', { class: 'ghost', id: 'show-record', 'aria-pressed': 'false', title: 'Your own use of the tutor in this folder' }, 'Record'),
};
let view = 'chat';
let connected = false;

function showView(next) {
  view = next;
  for (const [name, node] of Object.entries(views)) node.hidden = name !== view;
  for (const [name, button] of Object.entries(viewButtons)) button.setAttribute('aria-pressed', String(name === view));
  chat.hidden = view !== 'chat';
  for (const part of [quickActions, form]) part.hidden = view !== 'chat' || !connected;
  if (view !== 'chat' || !connected) ladder.hidden = true;
  if (view === 'history') showHistory(() => showView('chat'));
  if (view === 'record') showRecord();
}
const toggleView = (name) => showView(view === name ? 'chat' : name);

function startNewConversation() {
  showView('chat');
  closeLadder();
  newConversation();
}

async function showFolder() {
  showPolicy();
  closeLadder();
  showView('chat');
  await resumeLatest();
}

function showConnection(auth) {
  connected = isConnected(auth);
  showSetup(auth);
  showView(view);
}

export function mount(region) {
  loadMathStyles();
  viewButtons.history.onclick = () => toggleView('history');
  viewButtons.record.onclick = () => toggleView('record');
  const newChat = h('button', { id: 'new-chat', class: 'ghost', title: 'New conversation (⇧⌘N)', onclick: startNewConversation }, 'New');
  region.append(
    paneHead(h('span', {}, 'Tutor'), spacer(), policy, viewButtons.history, viewButtons.record, newChat),
    policyNote,
    panelStrip,
    chat,
    historyView,
    recordView,
    setupBox,
    ladder,
    quickActions,
    form,
  );
  setupConversation();
  setupLookup();
  renderChips();
  region.addEventListener('keydown', (e) => e.key === 'Escape' && view !== 'chat' && showView('chat'));

  // View > Go to Tutor (⌘4): the question box, or the setup steps' button while not connected.
  registerFocusTarget('tutor', () => [input, setupBox.querySelector('button')].find((node) => node?.offsetParent) || null);
  registerCommand('new-conversation', startNewConversation);
  registerCommand('lookup', openLookup);
  on('workspace:opened', showFolder);
  on('auth:changed', showConnection);
  on('editor:cursor', showCursor);
  on('editor:active', () => renderChips());
  on('panel:toggled', ({ id, visible }) => id === 'tutor' && visible && view === 'chat' && input.focus());
}
