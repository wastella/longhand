// Markdown from the folder (a handout, a README) rendered for reading. A handout comes from the
// internet, so it is treated as hostile: it is sanitized, it runs no script, it loads nothing from
// the network (only pictures inside the open folder, read through the backend), and none of its
// links can navigate the window. Links to other files in the folder open them in Longhand,
// web links open in the browser, and #anchors scroll the document. Math and code look as they
// do in tutor answers.

import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { invoke } from '../backend.js';
import { h } from '../dom.js';
import { decode, FORBID_ATTR, FORBID_TAGS, keepOwnClasses, taskBoxes } from '../purify.js';
import { openFile } from '../editor/index.js';
import { drawFormulas, highlightBlocks, mathExtension } from '../tutor/index.js';
import { imageUrl, resolvePath, viewKind } from './files.js';

let formulas = [];
const marked = new Marked(
  { gfm: true, breaks: false },
  mathExtension((formula) => formulas.push(formula) - 1),
  taskBoxes,
);

const purifier = DOMPurify(window);
// Nothing the document says may load or point anywhere until the code below has checked it:
// image sources, link targets and element names move to data attributes the page cannot set
// itself (ALLOW_DATA_ATTR is off), before the nodes join this document.
purifier.addHook('afterSanitizeAttributes', (node) => {
  const move = (from, to) => {
    if (!node.hasAttribute(from)) return;
    node.setAttribute(to, node.getAttribute(from));
    node.removeAttribute(from);
  };
  keepOwnClasses(node);
  if (node.tagName === 'IMG') move('src', 'data-source');
  if (node.tagName === 'A') move('href', 'data-target');
  move('id', 'data-anchor');
  move('name', 'data-anchor');
});

const SANITIZE = {
  USE_PROFILES: { html: true },
  FORBID_TAGS,
  FORBID_ATTR,
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: ['data-math'],
  RETURN_DOM_FRAGMENT: true,
};

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to dashes, repeats numbered. */
function slugger() {
  const seen = new Map();
  return (text) => {
    const base = text
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  };
}

function scrollToAnchor(root, name) {
  const target = [...root.querySelectorAll('[data-anchor]')].find((node) => node.dataset.anchor === name || node.dataset.anchor === `user-content-${name}`);
  target?.scrollIntoView({ block: 'start' });
}

/** Makes a link do what its target means, without ever navigating the window. */
function wireLink(link, root, path) {
  const target = (link.dataset.target || '').trim();
  link.removeAttribute('data-target');
  let run = null;
  if (target.startsWith('#')) {
    const name = decode(target.slice(1));
    if (name !== null) run = () => scrollToAnchor(root, name);
  } else if (/^https?:\/\//i.test(target)) {
    link.dataset.tip = target;
    run = () => invoke('open_external', { url: target });
  } else if (target && !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('//')) {
    const name = decode(target.split(/[?#]/)[0]);
    const file = name && resolvePath(path, name);
    if (file) {
      link.dataset.tip = `Open ${file}`;
      run = () => openFile(file);
    }
  }
  if (!run) return link.classList.add('inert');
  Object.assign(link, { tabIndex: 0 });
  link.setAttribute('role', 'link');
  link.onclick = (e) => (e.preventDefault(), run());
  link.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), run()));
}

/** A picture from the folder, read through the backend; anything else is named, not loaded. */
function loadImage(img, path, isCurrent) {
  const source = (img.dataset.source || '').trim();
  img.removeAttribute('data-source');
  const missing = (why) => img.replaceWith(h('span', { class: 'md-image-missing' }, img.alt ? `${img.alt} ` : '', h('span', { class: 'dim' }, `(${why})`)));
  if (/^data:image\/(png|jpe?g|gif|webp);/i.test(source)) return void (img.src = source);
  if (/^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith('//')) return missing('image from the web, not loaded');
  const name = source && decode(source.split(/[?#]/)[0]);
  const file = name && resolvePath(path, name);
  if (!file || viewKind(file) !== 'image') return missing('image not found in this folder');
  imageUrl(file).then(
    (url) => isCurrent() && (img.src = url),
    (problem) => isCurrent() && missing(problem.code === 'missing' ? 'image not found in this folder' : `${file} could not be shown`),
  );
}

/**
 * Renders `text` (Markdown in the file `path`, relative to the open folder) into `node`, replacing
 * what was there. Pictures arrive as they load.
 */
export function renderMarkdown(node, text, path) {
  formulas = [];
  const html = marked.parse(text);
  const found = formulas;
  const fragment = purifier.sanitize(html, SANITIZE);
  const slug = slugger();
  for (const heading of fragment.querySelectorAll('h1, h2, h3, h4, h5, h6')) if (!heading.dataset.anchor) heading.dataset.anchor = slug(heading.textContent);
  const render = (node.dataset.render = String(Number(node.dataset.render || 0) + 1));
  const isCurrent = () => node.dataset.render === render;
  for (const img of fragment.querySelectorAll('img')) loadImage(img, path, isCurrent);
  for (const link of fragment.querySelectorAll('a')) wireLink(link, node, path);
  node.replaceChildren(fragment);
  highlightBlocks(node);
  drawFormulas(node, found);
}
