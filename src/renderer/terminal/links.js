// Makes file locations and web links in terminal output clickable. A location opens in the
// editor at its line, but only when the backend confirms it is a file inside the open folder;
// a web link opens in the browser. Hovering underlines the link and names where it goes.

import { invoke } from '../backend.js';
import { h } from '../dom.js';
import { openFile } from '../editor/index.js';
import { findLocations } from './locations.js';

/**
 * The logical line through buffer row `y` (rows joined where the terminal wrapped them), with
 * the cell under each character of its text, since wide characters take two cells.
 */
function logicalLine(buffer, y) {
  let first = y;
  while (first > 0 && buffer.getLine(first)?.isWrapped) first--;
  let text = '';
  const cells = [];
  for (let row = first; row === first || buffer.getLine(row)?.isWrapped; row++) {
    const line = buffer.getLine(row);
    if (!line) break;
    for (let x = 0; x < line.length; x++) {
      const cell = line.getCell(x);
      if (!cell || cell.getWidth() === 0) continue;
      const chars = cell.getChars() || ' ';
      for (let i = 0; i < chars.length; i++) cells.push({ x, y: row, width: cell.getWidth() });
      text += chars;
    }
  }
  return { text: text.trimEnd(), cells };
}

/** Shows where a hovered link goes, just above the pointer. */
function linkHint(container) {
  const hint = h('div', { class: 'term-link-hint', role: 'tooltip', hidden: true });
  container.append(hint);
  return {
    show(event, text) {
      const box = container.getBoundingClientRect();
      hint.textContent = text;
      hint.hidden = false;
      hint.style.left = `${Math.min(event.clientX - box.left, box.width - hint.offsetWidth - 8)}px`;
      hint.style.top = `${Math.max(event.clientY - box.top - hint.offsetHeight - 10, 4)}px`;
    },
    hide: () => (hint.hidden = true),
  };
}

const describe = (location) => (location.line ? `${location.path}, line ${location.line}` : location.path);

/** Registers the link provider on `session`'s terminal. `container` holds the hover hint. */
export function addLinks(session, container) {
  const { xterm } = session;
  const hint = linkHint(container);
  const link = (line, found, target, activate, label) => {
    const at = (offset) => line.cells[offset];
    const last = at(found.end - 1);
    return {
      range: { start: { x: at(found.start).x + 1, y: at(found.start).y + 1 }, end: { x: last.x + last.width, y: last.y + 1 } },
      text: target,
      decorations: { underline: true, pointerCursor: true },
      activate: (event) => event.button === 0 && activate(),
      hover: (event) => hint.show(event, label),
      leave: hint.hide,
    };
  };

  xterm.registerLinkProvider({
    async provideLinks(row, callback) {
      const line = logicalLine(xterm.buffer.active, row - 1);
      const found = findLocations(line.text).filter((f) => f.end <= line.cells.length);
      const urls = found.filter((f) => f.url);
      const files = found.filter((f) => f.path);
      const resolved = files.length && session.id ? await invoke('term_resolve', { id: session.id, paths: files.map((f) => f.path) }) : [];
      const links = urls.map((f) => link(line, f, f.url, () => invoke('open_external', { url: f.url }), `Open ${f.url} in the browser`));
      files.forEach((f, i) => {
        const path = resolved[i];
        if (path) links.push(link(line, f, path, () => openFile(path, f.line ?? undefined), `Open ${describe({ path, line: f.line })}`));
      });
      callback(links.length ? links : undefined);
    },
  });

  // Hyperlinks programs print with OSC 8 (ls --hyperlink, rich) open the same way as typed URLs.
  xterm.options.linkHandler = {
    activate: (event, uri) => /^https?:\/\//.test(uri) && invoke('open_external', { url: uri }),
    hover: (event, uri) => hint.show(event, `Open ${uri} in the browser`),
    leave: hint.hide,
  };
}
