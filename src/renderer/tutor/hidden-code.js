// The interface's own check on the tutor's output, on top of its prompt: code blocks longer than
// the policy allows stay hidden until the student chooses to reveal them, and each reveal is
// recorded in the folder's usage log.

import { invoke } from '../backend.js';
import { h } from '../dom.js';
import { emit, state } from '../state.js';

const LINE_LIMIT = { strict: 2, guided: 12 };
// Shell commands and plain output are not solutions, so they are never hidden.
const EXEMPT_LANGUAGES = new Set(['text', 'txt', 'console', 'bash', 'sh', 'shell', 'zsh', 'output', 'plaintext']);

/**
 * Replaces over-long code blocks inside `node` with a notice. `message.revealed` holds the
 * indexes of blocks already revealed; while `message.streaming` the notice has no button yet.
 * `rerender` draws the message again after a reveal.
 */
export function hideLongCode(node, message, rerender) {
  const policy = state.config.policy;
  const limit = LINE_LIMIT[policy] ?? LINE_LIMIT.strict;
  node.querySelectorAll('pre').forEach((pre, i) => {
    const code = pre.querySelector('code');
    const language = ((code && code.className.match(/language-(\S+)/)) || [])[1] || '';
    const lines = pre.textContent.replace(/\n+$/, '').split('\n').length;
    if (EXEMPT_LANGUAGES.has(language) || lines <= limit || message.revealed.has(i)) return;
    if (message.streaming) return pre.replaceWith(h('div', { class: 'withheld' }, 'The tutor is writing code…'));
    const reveal = async () => {
      message.revealed.add(i);
      emit('usage:changed', await invoke('log_record', { kind: 'reveal', detail: { lines, policy } }));
      rerender();
    };
    pre.replaceWith(
      h(
        'div',
        { class: 'withheld' },
        h('span', {}, `The tutor wrote ${lines} lines of code, hidden under the ${policy} policy.`),
        h('button', { onclick: reveal }, 'Reveal (logged)'),
      ),
    );
  });
}
