// The interface's own check on the tutor's output, on top of its prompt: when an answer holds
// more lines of code than the policy allows, all of its code stays hidden until the student
// chooses to reveal it, and the reveal is recorded in the folder's usage log.
//
// Code is counted across the whole answer, wherever it is: code blocks (a block labelled bash or
// text counts when its body is plainly Python), inline code that forms a line of its own (a table
// row, a line ended by a hard break, a statement in a sentence), raw <code> with <br>, and code
// set in math (\texttt, \verb, \mathtt, or text that reads as Python). So a solution split into
// several one-line pieces is hidden just as one block would be.

import { invoke } from '../backend.js';
import { h } from '../dom.js';
import { state } from '../state.js';
import { formulaTex } from './math.js';

const LINE_LIMIT = { strict: 2, guided: 12 };
// Shell commands and plain output are not solutions, so blocks labelled as these are not counted,
// unless what is inside is Python.
const EXEMPT_LANGUAGES = new Set(['text', 'txt', 'console', 'bash', 'sh', 'shell', 'zsh', 'output', 'plaintext']);

const OP = String.raw`(?:\*\*|\/\/|[-+*/@%])`;
/** A Python statement: on any line, it is code. */
const STATEMENT = [
  /^\s*(?:async\s+)?(?:def|class)\s+\w+\s*[(:]/,
  /^\s*(?:return|yield|raise|assert|del|global|nonlocal)\b/,
  /^\s*(?:import\s+\w|from\s+[\w.]+\s+import\b)/,
  /^\s*(?:for|while|if|elif|with)\b.*:\s*$/,
  /^\s*(?:else|try|finally)\s*:/,
  /^\s*except\b.*:\s*$/,
  // An assignment, written as Python is (spaces around =), so a keyword argument is not one.
  new RegExp(String.raw`^\s*[A-Za-z_][\w.]*(?:\[[^\]]*\])?(?:\s*,\s*[A-Za-z_][\w.]*)*\s+${OP}?=\s+\S`),
];
/** A Python expression that computes something: code when it stands on a line of its own. */
const EXPRESSION = [
  new RegExp(String.raw`\)\s*${OP}\s*[\w(]`),
  new RegExp(String.raw`[\w\]]\s*${OP}\s*[A-Za-z_][\w.]*\(`),
  /\w\([^()]*\)\.\w+\(/,
  /^\s*lambda\b/,
];

const any = (patterns, text) => patterns.some((p) => p.test(text));
export const isStatement = (line) => any(STATEMENT, line);
export const isCodeLine = (line) => any(STATEMENT, line) || any(EXPRESSION, line);
/** Whether a block's body is Python, whatever its label says. */
export const looksLikePython = (text) => text.split('\n').some(isStatement);

const TT = /\\(?:texttt|mathtt|tt|ttfamily|verb)(?![a-zA-Z])/;
const TEXT_ARG = /\\(?:text[a-z]*|math(?:rm|sf|it|bf|normal|tt)|operatorname\*?)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g;
const untex = (s) => s.replace(/\\([_{}#$%& ])/g, '$1').replace(/\\(?:quad|qquad|,|;|!)/g, ' ');

/** Lines of code set in the formula `tex`: rows in typewriter type, or whose text reads as code. */
export function formulaCodeLines(tex) {
  const rows = tex.split(/\\\\|\\cr(?![a-zA-Z])|\\newline(?![a-zA-Z])/);
  return rows.filter((row) => TT.test(row) || [...row.matchAll(TEXT_ARG)].some(([, text]) => isCodeLine(untex(text)))).length;
}

/** The text of `code`, split where it breaks lines (newlines and <br>). */
function segments(code) {
  const parts = [''];
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeName === 'BR') parts.push('');
      else if (c.nodeType === Node.TEXT_NODE) {
        const [first, ...rest] = c.textContent.split('\n');
        parts[parts.length - 1] += first;
        parts.push(...rest);
      } else walk(c);
    }
  };
  walk(code);
  return parts.map((s) => s.trim()).filter(Boolean);
}

const BLOCKS = 'p, li, td, th, dt, dd, h1, h2, h3, h4, h5, h6, blockquote, div';

/** The text of the line `target` sits on inside its block: between hard breaks. */
function lineAround(target) {
  const container = target.parentElement?.closest(BLOCKS) || target.parentElement;
  let line = '';
  let found = false;
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeName === 'BR') {
        if (found) return true;
        line = '';
      } else if (c === target) {
        found = true;
        line += c.textContent;
      } else if (c.nodeType === Node.TEXT_NODE) line += c.textContent;
      else if (walk(c)) return true;
    }
    return false;
  };
  if (container) walk(container);
  return line;
}

/** Lines of code in an inline <code>. */
function inlineLines(code) {
  const parts = segments(code);
  if (parts.length > 1) return parts.length;
  const text = parts[0] || '';
  if (isStatement(text)) return 1;
  if (!isCodeLine(text)) return 0;
  // An expression counts when it is most of its line, as in a table row or a list of steps.
  const rest = lineAround(code)
    .replace(text, '')
    .replace(/[\s\d.,:;()*–—-]+/g, '');
  return rest.length <= Math.max(12, text.length / 2) ? 1 : 0;
}

/** Every piece of code in `node`: [{ el, lines, block }]. */
export function codeUnits(node) {
  const units = [];
  for (const pre of node.querySelectorAll('pre')) {
    const language = ((pre.querySelector('code')?.className || '').match(/language-(\S+)/) || [])[1] || '';
    const body = pre.textContent.replace(/\n+$/, '');
    if (EXEMPT_LANGUAGES.has(language.toLowerCase()) && !looksLikePython(body)) continue;
    const lines = body.split('\n').filter((l) => l.trim()).length;
    if (lines) units.push({ el: pre, lines, block: true });
  }
  // Raw HTML can set code in other monospace elements too.
  for (const code of node.querySelectorAll('code, kbd, samp, tt')) {
    if (code.closest('pre') || code.parentElement?.closest('code, kbd, samp, tt')) continue;
    const lines = inlineLines(code);
    if (lines) units.push({ el: code, lines, block: false });
  }
  for (const math of node.querySelectorAll('.math')) {
    const tex = formulaTex.get(math);
    const lines = tex ? formulaCodeLines(tex) : 0;
    if (lines) units.push({ el: math, lines, block: math.classList.contains('math-display') });
  }
  return units;
}

/**
 * Hides all the code in `node` when, counted across the answer, it is longer than the policy
 * allows. `message.revealed` (a Set) is non-empty once the student has revealed this answer's
 * code; while `message.streaming` the notice has no button yet. `rerender` draws the message
 * again after a reveal.
 */
export function hideLongCode(node, message, rerender) {
  hideCodeAcross([node], message, rerender);
}

/**
 * The same check over several rendered answers that make up one: the notes of a review, or the
 * answers in one pinned conversation. Their code is counted together, so a solution split two
 * lines per note is hidden; when it is, every answer's code is hidden behind one notice per
 * answer, and one Reveal (logged once) shows it in all of them. `what` names the whole ("this
 * review's notes").
 */
export function hideCodeAcross(nodes, message, rerender, what = '') {
  const policy = state.config.policy;
  const limit = LINE_LIMIT[policy] ?? LINE_LIMIT.strict;
  const each = nodes.map((node) => codeUnits(node));
  const lines = each.flat().reduce((sum, u) => sum + u.lines, 0);
  if (lines <= limit || message.revealed.size) return false;
  const reveal = async () => {
    if (message.revealed.size) return;
    message.revealed.add('all');
    await invoke('log_record', { kind: 'reveal', detail: { lines, policy } });
    rerender();
  };
  const said = what
    ? `There are ${lines} lines of code across ${what}, hidden under the ${policy} policy.`
    : `The tutor wrote ${lines} lines of code, hidden under the ${policy} policy.`;
  const notice = () =>
    message.streaming
      ? h('div', { class: 'withheld' }, 'The tutor is writing code…')
      : h('div', { class: 'withheld' }, h('span', {}, said), h('button', { onclick: reveal }, 'Reveal (logged)'));
  nodes.forEach((node, i) => {
    if (!each[i].length) return;
    let noticed = false;
    for (const unit of each[i]) {
      if (unit.block && !noticed) {
        unit.el.replaceWith(notice());
        noticed = true;
      } else unit.el.replaceWith(h(unit.block ? 'div' : 'span', { class: `withheld ${unit.block ? 'more' : 'inline'}` }, 'code hidden'));
    }
    if (!noticed) node.append(notice());
  });
  return true;
}
