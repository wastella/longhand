// Turns a tutor answer into safe HTML. Answers are model output, so they are sanitized, may not
// carry styles, forms or images, and their links open in the browser rather than the window.

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { invoke } from '../backend.js';
import { hideLongCode } from './hidden-code.js';

marked.setOptions({ gfm: true, breaks: false });

/** Renders `text` (Markdown) into `node`. `message` is { revealed: Set, streaming } (see hidden-code.js). */
export function renderAnswer(node, text, message) {
  node.innerHTML = DOMPurify.sanitize(marked.parse(text), { FORBID_TAGS: ['style', 'form', 'input', 'button', 'img'], FORBID_ATTR: ['style'] });
  for (const link of node.querySelectorAll('a')) {
    const href = link.getAttribute('href') || '';
    link.removeAttribute('href');
    if (/^https?:\/\//.test(href)) {
      link.title = href;
      link.onclick = () => invoke('open_external', { url: href });
    }
  }
  hideLongCode(node, message, () => renderAnswer(node, text, message));
}
