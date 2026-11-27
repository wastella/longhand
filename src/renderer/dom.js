/**
 * Creates an element. `props` sets attributes, except `class` (the class name) and functions
 * under `on…` names (event listeners). `true` adds an empty attribute; `false` and null skip it.
 * Children may be nodes, strings or arrays of them.
 *
 *   h('button', { class: 'ghost', title: 'New file', onclick: newFile }, '+')
 */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...children.flat().filter((child) => child != null && child !== false));
  return node;
}

/** The flexible gap that pushes the rest of a row to the right. */
export const spacer = () => h('span', { class: 'spacer' });

/** A pane's header row; see docs/DESIGN.md. */
export const paneHead = (...children) => h('div', { class: 'pane-head' }, ...children);

/** A quiet one-line message in place of a list's content, such as "No matches." */
export const emptyState = (text) => h('p', { class: 'empty-state' }, text);

/** Reads a design token from tokens.css, for code that needs a value rather than var(). */
export const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
