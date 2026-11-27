// Turns a tutor answer into safe HTML. Answers are model output, so they are sanitized, may not
// carry styles, forms or images, and their links open in the browser rather than the window.
// Every answer shown anywhere goes through renderAnswer, which is also where the hidden-code
// check applies.

import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { invoke } from '../backend.js';
import { hideLongCode } from './hidden-code.js';
import { highlightBlocks } from './highlight.js';
import { drawFormulas, mathExtension } from './math.js';

/** Formulas found while parsing the answer being rendered; see math.js. */
let formulas = [];
const marked = new Marked(
  { gfm: true, breaks: false },
  mathExtension((formula) => formulas.push(formula) - 1),
);

/**
 * Renders `text` (Markdown) into `node`. `message` is { revealed: Set, streaming, grouped? } (see
 * hidden-code.js); a `grouped` answer skips the check here because its group runs hideCodeAcross.
 */
export function renderAnswer(node, text, message) {
  formulas = [];
  const html = marked.parse(text);
  const found = formulas;
  node.innerHTML = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'img', 'math', 'svg'],
    FORBID_ATTR: ['style'],
  });
  for (const link of node.querySelectorAll('a')) {
    const href = link.getAttribute('href') || '';
    link.removeAttribute('href');
    if (/^https?:\/\//.test(href)) {
      link.title = href;
      link.onclick = () => invoke('open_external', { url: href });
    }
  }
  highlightBlocks(node);
  drawFormulas(node, found);
  // An answer that is part of a larger one (feedback's code groups) is checked with the rest.
  if (!message.grouped) hideLongCode(node, message, () => renderAnswer(node, text, message));
}
