// Tooltips for anything with a data-tip attribute, shown after a short hover or on keyboard
// focus. data-tip-command names a menu command whose shortcut is shown beside the text, so the
// keys always match the menu. One floating element serves every tooltip, which keeps them out of
// panes that clip their content.

import { h } from '../dom.js';
import { formatKeys } from './keys.js';
import { keysFor } from './shortcuts.js';

const DELAY = 500;
const GAP = 6;
const EDGE = 8;

const tip = h('div', { class: 'tooltip', role: 'tooltip', id: 'tooltip', hidden: true });
let timer;
let owner = null;

function show(target) {
  const keys = target.dataset.tipCommand && keysFor(target.dataset.tipCommand);
  tip.replaceChildren(h('span', {}, target.dataset.tip));
  if (keys) tip.append(h('span', { class: 'kbd-text' }, formatKeys(keys)));
  tip.hidden = false;
  owner = target;
  target.setAttribute('aria-describedby', 'tooltip');
  // Below the target, or above it when there is no room; always inside the window.
  const box = target.getBoundingClientRect();
  const { offsetWidth: width, offsetHeight: height } = tip;
  const below = box.bottom + GAP + height <= window.innerHeight - EDGE;
  tip.style.top = `${below ? box.bottom + GAP : box.top - GAP - height}px`;
  tip.style.left = `${Math.max(EDGE, Math.min(box.left + box.width / 2 - width / 2, window.innerWidth - width - EDGE))}px`;
}

function hide() {
  clearTimeout(timer);
  tip.hidden = true;
  owner?.removeAttribute('aria-describedby');
  owner = null;
}

function schedule(target, delay) {
  if (target === owner) return;
  hide();
  if (target?.dataset.tip) timer = setTimeout(() => target.isConnected && show(target), delay);
}

export function mountTooltips() {
  document.body.append(tip);
  document.addEventListener('mouseover', (e) => schedule(e.target.closest?.('[data-tip]'), DELAY));
  document.addEventListener('focusin', (e) => e.target.matches(':focus-visible') && schedule(e.target.closest('[data-tip]'), 0));
  document.addEventListener('focusout', hide);
  document.addEventListener('mousedown', hide, true);
  document.addEventListener('keydown', hide, true);
  document.addEventListener('scroll', hide, true);
}
