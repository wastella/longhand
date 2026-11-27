import { h } from '../dom.js';

/** Draws one tab per open file. A dirty tab shows a dot in place of its close button (see editor.css). */
export function renderTabBar(host, { docs, active }, { onSelect, onClose }) {
  host.replaceChildren(
    ...[...docs].map(([path, doc]) => {
      const close = h('span', { class: 'x', onclick: (e) => (e.stopPropagation(), onClose(path)) }, h('span', {}, '×'));
      const cls = 'tab' + (path === active ? ' active' : '') + (doc.dirty ? ' dirty' : '');
      return h('div', { class: cls, title: path, onclick: () => onSelect(path) }, h('span', {}, path.split('/').pop()), close);
    }),
  );
}
