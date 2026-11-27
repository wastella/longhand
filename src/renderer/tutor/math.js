// Math in tutor answers: $…$ and \(…\) inline, $$…$$ and \[…\] on their own lines, drawn with
// KaTeX. Marked only leaves a placeholder for each formula; the formula is drawn after the answer
// has been sanitized, and KaTeX's own output is sanitized again on its own terms (it needs inline
// styles for layout, which answers may not otherwise carry).

import katex from 'katex';
import DOMPurify from 'dompurify';

// Styles KaTeX writes are sizes, offsets and colours. Anything that could load a resource,
// escape the answer's box or hide behind escapes is dropped.
const SAFE_STYLE = /^[\w\s:;.,%#()-]*$/;
const UNSAFE_STYLE = /url|expression|position|@|\\|behavior|z-index/i;

const purifier = DOMPurify(window);
purifier.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'style' && (!SAFE_STYLE.test(data.attrValue) || UNSAFE_STYLE.test(data.attrValue))) data.keepAttr = false;
});

// maxSize caps every size a formula sets (\rule, \raisebox, \kern…), in em; the CSS also clips
// each formula to its own box, so nothing drawn can land outside it.
const KATEX = { throwOnError: false, trust: false, strict: 'ignore', maxSize: 4, maxExpand: 300 };

/** The TeX of each drawn formula, by its node, for the hidden-code check (hidden-code.js). */
export const formulaTex = new WeakMap();

/** Draws `tex` as safe nodes inside `into`. */
function drawFormula(into, tex, displayMode) {
  const html = katex.renderToString(tex, { ...KATEX, displayMode });
  into.innerHTML = purifier.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    ADD_ATTR: ['style'],
    FORBID_TAGS: ['style', 'a', 'img', 'image', 'use', 'foreignObject'],
    FORBID_ATTR: ['href', 'xlink:href', 'src'],
  });
}

const INLINE = [/^\$\$([^$]+?)\$\$/, /^\\\(([\s\S]+?)\\\)/, /^\$(?![\s$])((?:\\\$|[^$\n])+?)(?<![\s\\])\$(?!\d)/];
const BLOCK = [/^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/, /^ {0,3}\\\[([\s\S]+?)\\\][ \t]*(?:\n+|$)/];

/**
 * A marked extension that hands each formula ({ tex, display }) to `collect`, which returns its
 * index, and leaves a placeholder. Call drawFormulas once the HTML is sanitized.
 */
export function mathExtension(collect) {
  const placeholder = (tag, text, display) => {
    const index = collect({ tex: text.trim(), display });
    return `<${tag} class="math${display ? ' math-display' : ''}" data-math="${index}"></${tag}>`;
  };
  return {
    extensions: [
      {
        name: 'mathBlock',
        level: 'block',
        start: (src) => src.match(/^ {0,3}(\$\$|\\\[)/m)?.index,
        tokenizer(src) {
          for (const pattern of BLOCK) {
            const m = pattern.exec(src);
            if (m) return { type: 'mathBlock', raw: m[0], text: m[1] };
          }
        },
        renderer: (token) => placeholder('div', token.text, true),
      },
      {
        name: 'math',
        level: 'inline',
        start: (src) => {
          const i = src.search(/\$|\\\(/);
          return i < 0 ? undefined : i;
        },
        tokenizer(src) {
          for (const [i, pattern] of INLINE.entries()) {
            const m = pattern.exec(src);
            if (m) return { type: 'math', raw: m[0], text: m[1], display: i === 0 };
          }
        },
        renderer: (token) => placeholder('span', token.text, token.display),
      },
    ],
  };
}

/** Replaces each placeholder in `node` with its formula. Placeholders out of range stay empty. */
export function drawFormulas(node, formulas) {
  for (const slot of node.querySelectorAll('[data-math]')) {
    const formula = formulas[Number(slot.dataset.math)];
    slot.removeAttribute('data-math');
    if (!formula) continue;
    drawFormula(slot, formula.tex, formula.display);
    formulaTex.set(slot, formula.tex);
  }
}

/** KaTeX's stylesheet and fonts are bundled into dist/katex/ (see build.mjs). */
export function loadMathStyles() {
  if (document.getElementById('katex-styles')) return;
  document.head.append(Object.assign(document.createElement('link'), { id: 'katex-styles', rel: 'stylesheet', href: 'katex/katex.min.css' }));
}
