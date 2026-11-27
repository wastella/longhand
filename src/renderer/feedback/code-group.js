// Answers that are parts of one answer, for the hidden-code check. A review is one answer split
// into notes, and a pinned conversation is answers to one problem, so a solution could arrive two
// lines at a time and never trip a check made per piece. A group renders every piece, counts the
// code across all of them (hideCodeAcross), and when the total is over the policy's limit hides
// the code in every piece behind one Reveal, logged once, that shows it in all.

import { hideCodeAcross, renderAnswer } from '../tutor/index.js';

/** A group of answers; `what` names them in the notice ("this review's notes"). */
export function codeGroup(what) {
  /** key -> { node, text, streaming } */
  const members = new Map();
  const revealed = new Set();
  const watchers = new Set();

  function draw() {
    for (const m of members.values()) renderAnswer(m.node, m.text, { revealed, streaming: m.streaming, grouped: true });
    const all = [...members.values()];
    hideCodeAcross(
      all.map((m) => m.node),
      { revealed, streaming: all.some((m) => m.streaming) },
      draw,
      what,
    );
    watchers.forEach((watch) => watch());
  }

  return {
    /** Shows `text` in `node` as the piece `key`, and checks the group again. */
    set(key, node, text, { streaming = false } = {}) {
      members.set(key, { node, text, streaming });
      draw();
    },
    /** A piece left (its note was dismissed, its answer removed). */
    remove(key) {
      if (members.delete(key)) draw();
    },
    /** Every piece whose key starts with `prefix` left (a note and its replies). */
    forget(prefix) {
      let gone = false;
      for (const key of [...members.keys()]) if (key.startsWith(prefix)) gone = members.delete(key) || gone;
      if (gone) draw();
    },
    has: (key) => members.has(key),
    get size() {
      return members.size;
    },
    /** Calls `watch()` after every redraw, for views derived from the rendered text. */
    watch: (watch) => watchers.add(watch),
    revealed,
  };
}
