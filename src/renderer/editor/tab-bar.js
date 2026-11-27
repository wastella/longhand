// The row of tabs above the editor, one per open file.

import { h } from '../dom.js';

/**
 * For each path, the file name and, when another open file has the same name, as much of its
 * folder as tells them apart: tests/test_model.py and model/test_model.py show "tests" and "model".
 */
export function tabLabels(paths) {
  const labels = new Map();
  const byName = new Map();
  for (const path of paths) {
    const name = path.split('/').pop();
    byName.set(name, [...(byName.get(name) || []), path]);
  }
  for (const [name, group] of byName) {
    const folders = group.map((path) => path.split('/').slice(0, -1));
    let depth = 1;
    const hintOf = (parts) => parts.slice(-depth).join('/');
    while (group.length > 1 && new Set(folders.map(hintOf)).size < group.length && folders.some((parts) => parts.length > depth)) depth++;
    group.forEach((path, i) => labels.set(path, { name, hint: group.length > 1 ? hintOf(folders[i]) : '' }));
  }
  return labels;
}

/** What the tab's marker means, for its tooltip and for screen readers. */
function stateOf(doc) {
  if (doc.banner) return 'needs attention';
  if (doc.dirty) return 'unsaved changes';
  return '';
}

/**
 * Draws one tab per open file. A tab shows a dot in place of its close button while it has
 * unsaved changes, and a warning dot while it needs attention (see editor.css). Middle-click
 * closes; arrow keys move between tabs and Enter opens one.
 */
export function renderTabBar(host, { docs, active }, { onSelect, onClose }) {
  const hadFocus = host.contains(document.activeElement);
  const labels = tabLabels([...docs.keys()]);
  const tabs = [...docs].map(([path, doc]) => {
    const { name, hint } = labels.get(path);
    const status = stateOf(doc);
    const close = h(
      'button',
      {
        class: 'tab-close',
        type: 'button',
        tabindex: '-1',
        'aria-label': `Close ${name}`,
        title: 'Close (⌘W)',
        onclick: (e) => (e.stopPropagation(), onClose(path)),
      },
      h('span', {}, '×'),
    );
    const classes = ['tab', path === active && 'active', doc.dirty && 'dirty', doc.banner && 'attention', doc.kind === 'notice' && 'notice'];
    return h(
      'div',
      {
        class: classes.filter(Boolean).join(' '),
        role: 'tab',
        tabindex: path === active ? '0' : '-1',
        'aria-selected': String(path === active),
        'aria-label': [name, hint && `in ${hint}`, status].filter(Boolean).join(', '),
        title: status ? `${path} (${status})` : path,
        'data-path': path,
        onclick: () => onSelect(path),
        onmousedown: (e) => e.button === 1 && e.preventDefault(),
        onauxclick: (e) => e.button === 1 && (e.preventDefault(), onClose(path)),
      },
      h('span', { class: 'tab-name' }, name),
      hint && h('span', { class: 'tab-hint' }, hint),
      close,
    );
  });
  host.replaceChildren(...tabs);
  const current = host.querySelector('.tab.active');
  current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (hadFocus) current?.focus();
}

/** Keyboard and wheel handling for the tab row; attached once. */
export function wireTabBar(host, { onSelect }) {
  host.setAttribute('role', 'tablist');
  host.setAttribute('aria-label', 'Open files');
  host.addEventListener('keydown', (e) => {
    const tabs = [...host.querySelectorAll('.tab')];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const move = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (move) {
      e.preventDefault();
      tabs[(i + move + tabs.length) % tabs.length].focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      tabs[e.key === 'Home' ? 0 : tabs.length - 1].focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(tabs[i].dataset.path);
    }
  });
  // Many tabs scroll sideways; a mouse wheel scrolls them too.
  host.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      host.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false },
  );
}
