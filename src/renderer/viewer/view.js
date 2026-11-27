// One read-only view of a file, for an editor tab or the handout pane: a PDF, a picture, or
// Markdown rendered for reading. Each remembers where the student was in the file.

import { invoke } from '../backend.js';
import { h } from '../dom.js';
import { openText } from '../editor/index.js';
import { isMarkdown, viewKind } from './files.js';
import { showImage } from './image.js';
import { renderMarkdown } from './markdown.js';
import { placeIn, rememberPlace } from './memory.js';
import { showPdf } from './pdf.js';
import { problemView } from './problem.js';

const SCROLL_DELAY = 250;

/** The text of a Markdown file: the editor's copy when it is open there, else the disk's. */
async function markdownText(path) {
  const open = openText(path);
  if (open != null) return open;
  const file = await invoke('doc_read', { rel: path });
  if (file.kind === 'text') return file.text;
  throw file.kind === 'missing' ? { code: 'missing' } : { code: file.kind === 'tooLarge' ? 'tooLarge' : 'unreadable', size: file.size };
}

/** Rendered Markdown that keeps its scroll position. `text` is given, or read from the file. */
function showMarkdown(host, path, text) {
  let gone = false;
  let timer = 0;
  const page = h('div', { class: 'md-doc' });
  const scroller = h('div', { class: 'md-scroll', tabindex: '0', 'aria-label': `${path}, rendered` }, page);
  const save = () => rememberPlace(path, { scroll: scroller.scrollTop });
  scroller.addEventListener('scroll', () => (clearTimeout(timer), (timer = setTimeout(save, SCROLL_DELAY))), { passive: true });
  (text != null ? Promise.resolve(text) : markdownText(path)).then(
    (source) => {
      if (gone) return;
      renderMarkdown(page, source, path);
      host.replaceChildren(scroller);
      scroller.scrollTop = placeIn(path).scroll || 0;
    },
    (problem) => !gone && host.replaceChildren(problemView(path, problem)),
  );
  return {
    destroy() {
      if (!gone && host.contains(scroller)) save();
      gone = true;
      clearTimeout(timer);
    },
  };
}

/**
 * Shows `path` read-only in `host`, replacing what was there. `text` is Markdown to render in
 * place of the file's own (an editor tab's unsaved text). Returns { destroy }, which the caller
 * calls before showing something else in `host`.
 */
export function showFile(host, path, { text } = {}) {
  const kind = viewKind(path);
  if (kind === 'pdf') return showPdf(host, path, { place: placeIn(path), onPlace: (place) => rememberPlace(path, place) });
  if (kind === 'image') return showImage(host, path);
  if (isMarkdown(path)) return showMarkdown(host, path, text);
  host.replaceChildren(problemView(path, { code: 'unreadable' }));
  return { destroy() {} };
}
