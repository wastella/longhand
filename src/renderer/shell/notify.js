// Notifications: short messages in the bottom-right corner that do not block anything.
// Information and success fade on their own; errors stay until dismissed. The host is a polite
// live region, so screen readers read new messages when idle; errors interrupt (role=alert).

import { h } from '../dom.js';
import { icon } from './icons.js';

const LIFETIME = { info: 5000, success: 4000 };
const MAX_SHOWN = 4;
const ICONS = { info: 'info', success: 'check', error: 'alert' };

const host = h('div', { class: 'notices', role: 'region', 'aria-label': 'Notifications', 'aria-live': 'polite' });

/**
 * Shows `message`. `kind` is 'info' (default), 'success' or 'error'. `action` is an optional
 * { label, run } button; running it also dismisses the notification. Showing a message that is
 * already on screen restarts it instead of stacking a copy. Returns a function that dismisses it.
 *
 *   notify({ message: 'Could not save notes.md', kind: 'error', action: { label: 'Try Again', run: save } })
 */
export function notify({ message, kind = 'info', action }) {
  if (!ICONS[kind]) throw new Error(`Unknown notification kind "${kind}"`);
  for (const old of host.children) if (old.dataset.message === message && old.dataset.kind === kind) old.dismiss();

  let timer;
  const startTimer = () => LIFETIME[kind] && (timer = setTimeout(dismiss, action ? LIFETIME[kind] * 2 : LIFETIME[kind]));
  const notice = h(
    'div',
    {
      class: `notice ${kind}`,
      role: kind === 'error' ? 'alert' : undefined,
      'data-kind': kind,
      onmouseenter: () => clearTimeout(timer),
      onmouseleave: startTimer,
    },
    icon(ICONS[kind], 'notice-icon'),
    h(
      'div',
      { class: 'notice-body' },
      h('p', { class: 'notice-message' }, message),
      action && h('button', { class: 'button small', onclick: () => (dismiss(), action.run()) }, action.label),
    ),
    h('button', { class: 'button ghost icon-button small notice-close', 'aria-label': 'Dismiss', onclick: () => dismiss() }, icon('x', 'small')),
  );
  notice.dataset.message = message;

  function dismiss() {
    clearTimeout(timer);
    notice.remove();
  }
  notice.dismiss = dismiss;

  host.append(notice);
  // Make room by dropping the oldest message that would fade anyway; errors stay until read.
  while (host.children.length > MAX_SHOWN) {
    const oldest = [...host.children].find((node) => node.dataset.kind !== 'error');
    if (!oldest) break;
    oldest.dismiss();
  }
  startTimer();
  return dismiss;
}

export function mountNotices() {
  document.body.append(host);
}
