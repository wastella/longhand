// Markdown cells and Markdown outputs, drawn like tutor answers (marked, math with KaTeX, Python
// colouring) and sanitised by safe-html.js. Images attached to the cell are shown from the
// notebook itself; any other image is replaced by its alt text, since it would load from the
// network or from a file the page cannot read.

import { Marked } from 'marked';
import { drawFormulas, highlightBlocks, mathExtension } from '../tutor/index.js';
import { setSafeHtml } from './safe-html.js';

let formulas = [];
let attachments = {};

const RASTER = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** A cell attachment ("attachment:name.png") as a data: URL, or the source unchanged. */
function attached(href) {
  const name = /^attachment:(.+)$/.exec(href || '')?.[1];
  const bundle = name && attachments?.[decodeURIComponent(name)];
  if (!bundle || typeof bundle !== 'object') return href;
  const mime = RASTER.find((type) => typeof bundle[type] === 'string' || Array.isArray(bundle[type]));
  if (!mime) return href;
  const data = [bundle[mime]].flat().join('').replace(/\s/g, '');
  return `data:${mime};base64,${data}`;
}

const marked = new Marked(
  { gfm: true, breaks: false },
  mathExtension((formula) => formulas.push(formula) - 1),
  { walkTokens: (token) => token.type === 'image' && (token.href = attached(token.href)) },
);

/** Draws `text` (Markdown) into `node`; `cellAttachments` is the cell's attachments field. */
export function renderMarkdown(node, text, cellAttachments) {
  formulas = [];
  attachments = cellAttachments || {};
  const html = marked.parse(text);
  const found = formulas;
  setSafeHtml(node, html, { keep: ['data-math'] });
  highlightBlocks(node);
  drawFormulas(node, found);
}

/** Draws LaTeX output (text/latex: "$x^2$", "\begin{equation}…") into `node`. */
export function renderLatex(node, tex) {
  const trimmed = tex.trim();
  const body = /^\$\$[\s\S]*\$\$$|^\\\[[\s\S]*\\\]$/.test(trimmed) || /^\$[^$]+\$$/.test(trimmed) ? trimmed : `$$\n${trimmed}\n$$`;
  renderMarkdown(node, body);
}
