// HTML from a notebook, made safe to show. A notebook may come from anywhere, and its saved
// outputs and Markdown are whatever its author (or a program) wrote, so nothing in them may run,
// load anything from the network, or navigate the window: scripts, styles, frames, forms, media,
// image maps and inline SVG are dropped; images stay only as data: URLs (markdown.js turns cell
// attachments into those); links open in the browser when they are http(s), and do nothing
// otherwise. Ids, names and classes go too, except the few classes outputs are styled by, so
// saved HTML cannot pass for the app's own parts (a class that covers the window, say); and
// .nb-output and .nb-rendered contain their layout, so nothing positioned can leave them. The content
// security policy (tauri.conf.json) blocks remote loads and inline scripts as a second line.

import DOMPurify from 'dompurify';
import { invoke } from '../backend.js';

const purifier = DOMPurify(window);
const RASTER = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
/** Classes kept: pandas tables, code languages (for colouring) and math placeholders. */
const KEPT_CLASS = /^(dataframe|math|math-display|language-[\w-]+)$/;

purifier.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName !== 'class') return;
  data.attrValue = data.attrValue
    .split(/\s+/)
    .filter((name) => KEPT_CLASS.test(name))
    .join(' ');
  if (!data.attrValue) data.keepAttr = false;
});

purifier.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'IMG') {
    const src = node.getAttribute('src') || '';
    if (!RASTER.test(src)) {
      const alt = node.getAttribute('alt');
      node.replaceWith(Object.assign(document.createElement('span'), { className: 'nb-image-missing', textContent: alt ? `[image: ${alt}]` : '[image]' }));
    }
  }
});

const CONFIG = {
  FORBID_TAGS: [
    'style',
    'link',
    'meta',
    'base',
    'iframe',
    'frame',
    'object',
    'embed',
    'form',
    'input',
    'button',
    'textarea',
    'select',
    'svg',
    'math',
    'video',
    'audio',
    'source',
    'track',
    'picture',
    'template',
    'map',
    'area',
    'dialog',
    'portal',
  ],
  FORBID_ATTR: ['style', 'border', 'srcset', 'action', 'formaction', 'background', 'poster', 'xlink:href', 'usemap', 'id', 'name', 'ping'],
  ALLOW_DATA_ATTR: false,
};

/** Links: http(s) open in the browser; anything else (javascript:, files, anchors) does nothing. */
function tameLinks(node) {
  for (const link of node.querySelectorAll('a')) {
    const href = link.getAttribute('href') || '';
    link.removeAttribute('href');
    link.removeAttribute('target');
    if (/^https?:\/\//i.test(href)) {
      link.href = href;
      link.title = href;
      link.onclick = (e) => {
        e.preventDefault();
        invoke('open_external', { url: href });
      };
    }
  }
}

/** Sanitises `html` into `node`; `keep` lets extra attributes through (math placeholders). */
export function setSafeHtml(node, html, { keep = [] } = {}) {
  const fragment = purifier.sanitize(html, { ...CONFIG, ADD_ATTR: keep, RETURN_DOM_FRAGMENT: true });
  tameLinks(fragment);
  node.replaceChildren(fragment);
}
