// Draws a cell's outputs. Each output shows the richest kind Longhand can show safely, in the
// order JupyterLab prefers them; widgets and JavaScript get one calm line instead. Long text
// shows its start and end with a button for the rest, so a huge log cannot freeze the page.

import { h } from '../dom.js';
import { ansiNodes } from './ansi.js';
import { joinLines } from './json.js';
import { renderLatex, renderMarkdown } from './markdown.js';
import { setSafeHtml } from './safe-html.js';

/** Lines of text shown before the rest is folded away: the first HEAD and the last TAIL. */
const HEAD_LINES = 100;
const TAIL_LINES = 200;

const IMAGES = ['image/png', 'image/jpeg', 'image/gif'];
const PREFERRED = ['text/html', 'text/markdown', 'text/latex', 'image/svg+xml', ...IMAGES, 'text/plain'];
const WIDGET = 'application/vnd.jupyter.widget-view+json';

/** Which of a bundle's kinds to show: a mime type, or null when there is none Longhand shows. */
export function chooseMime(data) {
  if (!data || typeof data !== 'object') return null;
  const rich = PREFERRED.find((mime) => mime in data && mime !== 'text/plain');
  if (rich) return rich;
  // A widget's text/plain is only its Python repr ("IntProgress(value=3)"), not worth showing.
  if (WIDGET in data || 'application/javascript' in data) return null;
  return 'text/plain' in data ? 'text/plain' : null;
}

/** What to say for a bundle Longhand does not show. */
function unsupported(data) {
  const kinds = Object.keys(data || {});
  if (kinds.includes(WIDGET)) return 'An interactive widget. Longhand does not show widgets; open the notebook in Jupyter to use it.';
  if (kinds.includes('application/javascript')) return 'JavaScript output. Longhand does not run scripts from notebooks.';
  return `An output Longhand cannot show${kinds.length ? ` (${kinds.join(', ')})` : ''}.`;
}

/**
 * Text in a <pre>, with terminal colours. Text with more than HEAD_LINES + TAIL_LINES lines
 * shows its start and end, and a button that shows all of it.
 */
export function textBlock(text, className) {
  const pre = h('pre', { class: className });
  // A line still waiting to be overwritten ends in a carriage return; it shows as it is now.
  const shown = text.replace(/\r$/, '');
  const lines = shown.replace(/\n$/, '').split('\n');
  const fold = HEAD_LINES + TAIL_LINES;
  if (lines.length <= fold + 20) {
    pre.append(...ansiNodes(shown));
    return pre;
  }
  const hidden = lines.length - fold;
  const more = h(
    'button',
    {
      type: 'button',
      class: 'nb-more',
      onclick: () => pre.replaceChildren(...ansiNodes(shown)),
    },
    `${hidden.toLocaleString('en-US')} more lines · Show all`,
  );
  pre.append(...ansiNodes(lines.slice(0, HEAD_LINES).join('\n') + '\n'), more, ...ansiNodes('\n' + lines.slice(-TAIL_LINES).join('\n')));
  return pre;
}

function imageNode(mime, value) {
  const data = joinLines(value).replace(/\s/g, '');
  return h('img', { class: 'nb-image', alt: '', src: `data:${mime};base64,${data}` });
}

/** An SVG as an image (never as markup, so it cannot run anything or load anything). */
function svgNode(value) {
  return h('img', { class: 'nb-image', alt: '', src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(joinLines(value))}` });
}

function bundleNode(data) {
  const mime = chooseMime(data);
  if (!mime) return h('p', { class: 'nb-unsupported' }, unsupported(data));
  const value = data[mime];
  if (IMAGES.includes(mime)) return imageNode(mime, value);
  if (mime === 'image/svg+xml') return svgNode(value);
  const text = joinLines(value);
  if (mime === 'text/plain') return textBlock(text, 'nb-text');
  const node = h('div', { class: mime === 'text/html' ? 'nb-html' : 'nb-markdown' });
  if (mime === 'text/html') setSafeHtml(node, text);
  else if (mime === 'text/markdown') renderMarkdown(node, text);
  else renderLatex(node, text);
  return node;
}

/** The DOM for one nbformat output. */
export function outputNode(output) {
  switch (output?.output_type) {
    case 'stream':
      return textBlock(joinLines(output.text), output.name === 'stderr' ? 'nb-text nb-stderr' : 'nb-text');
    case 'error':
      return textBlock(
        Array.isArray(output.traceback) && output.traceback.length ? output.traceback.join('\n') : `${output.ename}: ${output.evalue}`,
        'nb-text nb-error',
      );
    case 'execute_result':
    case 'display_data':
      return bundleNode(output.data);
    default:
      return h('p', { class: 'nb-unsupported' }, `An output Longhand cannot show (${output?.output_type ?? 'unknown'}).`);
  }
}
