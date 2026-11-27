// Terminal colours in output text (tracebacks, colourful logs) as spans. Only colour and weight
// escapes (SGR) are drawn; every other escape sequence is dropped. Colours are the terminal's
// --color-ansi-* tokens, so outputs match the terminal in both themes. Text is only ever added
// as text nodes.

import { h } from '../dom.js';

const NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
// eslint-disable-next-line no-control-regex
const ESCAPE = /\x1b\[([0-9;]*)([A-Za-z])|\x1b[^[]?/g;

const colour = (n) => `var(--color-ansi-${n >= 8 ? 'bright-' : ''}${NAMES[n % 8]})`;

/** The 256-colour palette entry `n` as CSS: the 16 tokens, then the 6×6×6 cube and the greys. */
function palette(n) {
  if (n < 16) return colour(n);
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v}, ${v}, ${v})`;
  }
  const i = n - 16;
  const level = (c) => (c ? 55 + c * 40 : 0);
  return `rgb(${level(Math.floor(i / 36))}, ${level(Math.floor(i / 6) % 6)}, ${level(i % 6)})`;
}

function apply(style, codes) {
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c === 0) Object.assign(style, { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false });
    else if (c === 1) style.bold = true;
    else if (c === 2) style.dim = true;
    else if (c === 3) style.italic = true;
    else if (c === 4) style.underline = true;
    else if (c === 22) style.bold = style.dim = false;
    else if (c === 23) style.italic = false;
    else if (c === 24) style.underline = false;
    else if (c >= 30 && c <= 37) style.fg = colour(c - 30);
    else if (c >= 90 && c <= 97) style.fg = colour(c - 90 + 8);
    else if (c >= 40 && c <= 47) style.bg = colour(c - 40);
    else if (c >= 100 && c <= 107) style.bg = colour(c - 100 + 8);
    else if (c === 39) style.fg = null;
    else if (c === 49) style.bg = null;
    else if ((c === 38 || c === 48) && codes[i + 1] === 5) {
      style[c === 38 ? 'fg' : 'bg'] = palette(codes[i + 2] ?? 0);
      i += 2;
    } else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
      const [r, g, b] = codes.slice(i + 2, i + 5).map((v) => Math.min(255, v || 0));
      style[c === 38 ? 'fg' : 'bg'] = `rgb(${r}, ${g}, ${b})`;
      i += 4;
    }
  }
}

function piece(text, style) {
  if (!style.fg && !style.bg && !style.bold && !style.dim && !style.italic && !style.underline) return text;
  const css = [
    style.fg && `color: ${style.fg}`,
    style.bg && `background-color: ${style.bg}`,
    style.bold && 'font-weight: var(--weight-strong)',
    style.dim && 'opacity: 0.7',
    style.italic && 'font-style: italic',
    style.underline && 'text-decoration: underline',
  ];
  return h('span', { style: css.filter(Boolean).join('; ') }, text);
}

/** `text` with its colour escapes drawn, as a list of strings and spans. */
export function ansiNodes(text) {
  const style = {};
  const out = [];
  let last = 0;
  for (const match of text.matchAll(ESCAPE)) {
    if (match.index > last) out.push(piece(text.slice(last, match.index), style));
    if (match[2] === 'm') apply(style, (match[1] || '0').split(';').map(Number));
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(piece(text.slice(last), style));
  return out;
}
