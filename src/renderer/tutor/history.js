// Earlier conversations in this folder, newest first. Picking one reopens it where it left off.

import { emptyState, h } from '../dom.js';
import { CONVERSATION_PREFIX, currentThread, openThread } from './conversation.js';
import { listThreads } from './engine.js';
import { storageNote } from './record.js';

/** "14:02" today, "Yesterday", or "26 Nov". */
export function when(iso, now = new Date()) {
  const at = new Date(iso);
  if (at.toDateString() === now.toDateString()) return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (at.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return at.toLocaleDateString([], { day: 'numeric', month: 'short', year: at.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

const list = h('div', { id: 'history-list', role: 'list' });
export const historyView = h('div', { id: 'history', class: 'tutor-view', hidden: true }, list, storageNote());

/** Fills the list; `onOpen` runs after a conversation is picked. */
export async function showHistory(onOpen) {
  const threads = await listThreads(CONVERSATION_PREFIX);
  if (!threads.length) return list.replaceChildren(emptyState('No conversations in this folder yet.'));
  list.replaceChildren(
    ...threads.map((t) =>
      h(
        'button',
        {
          class: `thread list-row${t.id === currentThread() ? ' active' : ''}`,
          role: 'listitem',
          'aria-current': t.id === currentThread() ? 'true' : null,
          onclick: async () => {
            await openThread(t.id);
            onOpen();
          },
        },
        h('span', { class: 'thread-title' }, t.title || 'Untitled'),
        h('span', { class: 'thread-meta' }, `${when(t.updated)} · ${t.messages} ${t.messages === 1 ? 'message' : 'messages'}`),
      ),
    ),
  );
}
