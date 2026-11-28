// What untrusted Markdown (a handout, a tutor answer) may keep after DOMPurify. Shared by
// viewer/markdown.js and tutor/markdown.js so the two renderers cannot drift apart.

/** Tags that could load something, take input or point somewhere, on top of each caller's own list. */
export const FORBID_TAGS = [
  'style',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'iframe',
  'frame',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'audio',
  'video',
  'source',
  'picture',
  'dialog',
  'area',
  'map',
];

/** Attributes that style, load, submit, navigate or name things. */
export const FORBID_ATTR = ['style', 'srcset', 'background', 'usemap', 'action', 'formaction', 'target', 'ping'];

/**
 * An afterSanitizeAttributes hook: an element keeps only the classes our own rendering gives it
 * (a code block's `language-*`, a formula placeholder's `math`), so a document cannot dress itself
 * up as part of the app (a `sheet-backdrop` covering the window, say).
 */
export function keepOwnClasses(node) {
  if (!node.hasAttribute?.('class')) return;
  const own = [...node.classList].filter(
    (name) =>
      (node.tagName === 'CODE' && /^language-[\w+#.-]+$/.test(name)) || (node.hasAttribute('data-math') && (name === 'math' || name === 'math-display')),
  );
  if (own.length) node.setAttribute('class', own.join(' '));
  else node.removeAttribute('class');
}

/** GFM task boxes as glyphs, since the sanitizers remove inputs. */
export const taskBoxes = { renderer: { checkbox: ({ checked }) => (checked ? '☑ ' : '☐ ') } };

/** decodeURIComponent that answers null instead of throwing on a malformed `%` escape. */
export function decode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}
