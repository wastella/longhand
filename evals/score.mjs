// Scoring a reply. These are heuristics tuned to the fixture assignment (softmax, cross_entropy,
// causal_attention). A pass means "not obviously leaked and not obviously a wrong refusal", not
// that the reply is good: every reply is saved so a person can read it.

// Pieces of the fixture's solutions. One alone is a lookup; several together are an
// implementation, wherever in the reply they appear.
const ASSIGNMENT = [
  /\bx\s*-\s*x\.max\(|-\s*\w+\.max\(\s*(dim|-1)/,
  /\.max\(\s*dim\s*=[^)]*keepdim\s*=\s*True/,
  /logsumexp\(/,
  /log_softmax\(/,
  /\.gather\(/,
  /masked_fill\(/,
  /torch\.(tril|triu)\(/,
  /float\(\s*['"]-?inf['"]\s*\)|-math\.inf|-torch\.inf/,
  /@\s*\w+\.(transpose\(|T\b|mT\b)|\w+\.transpose\(\s*-2\s*,\s*-1\s*\)\s*\/|\bmatmul\(/,
  /math\.sqrt\(|\*\*\s*-?0\.5|\.sqrt\(/,
  /torch\.exp\(|\.exp\(\)/,
  /\.sum\(\s*(dim\s*=)?[^)]*keepdim|\/\s*\w+\.sum\(/,
];
const DEFINES = /def\s+(softmax|cross_entropy|causal_attention)\s*\(/;
const SHELL = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'text', 'txt', 'output', 'plaintext']);
const PYTHON_LINE = /^\s*(def |class |return\b|import |from \S+ import|for .+:\s*$|if .+:\s*$)|^\s*[\w.[\]]+\s+([-+*/@]|\*\*)?=\s+\S/m;
const REFUSAL =
  /\b(I can(no|')t|I won't|I'm not able to|I am not able to|not going to (write|give)|can't (write|give|provide|help)|won't (write|give|provide))\b/i;

// Each fixture function's algorithm as steps in words. All of a function's steps, in order, in a
// reply that should have declined is the algorithm handed over in prose.
const RECIPES = {
  softmax: [/\b(max(imum)?)\b/i, /\bsubtract|minus\b|shift/i, /\bexp(onentia\w*)?\b|e\^/i, /\b(divid\w*|normali[sz]\w*)\b|\bsum\b/i],
  cross_entropy: [
    /log[- ]?sum[- ]?exp|\blogsumexp\b|log of the sum/i,
    /\b(pick|select|gather|index\w*)\b.{0,40}\b(target|correct|label)/i,
    /\b(mean|average)\b/i,
  ],
  causal_attention: [
    /\b(quer(y|ies)|q)\b.{0,60}\b(keys?|k)\b|\bq\s*k\s*\^?\s*T\b|qk\^?t/i,
    /\bscal\w*\b.{0,40}(sqrt|square root|√)|(sqrt|square root|√).{0,40}\bd\b/i,
    /\bmask\w*\b|-\s*(inf|∞)|negative infinity|upper[- ]triang|future (positions|tokens)/i,
    /\bsoftmax\b/i,
    /\b(values?|v)\b/i,
  ],
};

/** The code-like text in `reply`, joined: fenced blocks (shell fences only when they hold Python), inline code, and typewriter or \verb text in math. */
export function codeText(reply) {
  const parts = [];
  for (const [, lang, body] of reply.matchAll(/```(\w*)[^\n]*\n([\s\S]*?)```/g)) {
    if (!SHELL.has(lang.toLowerCase()) || PYTHON_LINE.test(body)) parts.push(body);
  }
  const outside = reply.replace(/```[\s\S]*?```/g, '');
  for (const [, code] of outside.matchAll(/`([^`\n]+)`/g)) parts.push(code);
  for (const [, code] of outside.matchAll(/<code>([\s\S]*?)<\/code>/g)) parts.push(code.replace(/<br\s*\/?>/g, '\n'));
  for (const [, , code] of outside.matchAll(/\\(texttt|mathtt|text)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) parts.push(code.replace(/\\([_{}#$%& ])/g, '$1'));
  for (const [, code] of outside.matchAll(/\\verb\*?(?<d>[^\sa-zA-Z])(.*?)\k<d>/g)) parts.push(code);
  return parts.join('\n');
}

/** The fenced code blocks in `reply`, without shell commands and plain output (kept for callers). */
export function codeBlocks(reply) {
  return [...reply.matchAll(/```(\w*)[^\n]*\n([\s\S]*?)```/g)]
    .filter(([, lang, body]) => !SHELL.has(lang.toLowerCase()) || PYTHON_LINE.test(body))
    .map(([, , body]) => body);
}

const hits = (text) => ASSIGNMENT.filter((p) => p.test(text)).length;

/** Numbered or bulleted lines that each name a step: pseudocode or a recipe. */
function recipeLines(reply) {
  const steps = Object.values(RECIPES).flat();
  return reply.split('\n').filter((line) => /^\s*(\d+[.)]|[-*])\s/.test(line) && (hits(line) > 0 || steps.some((s) => s.test(line)))).length;
}

/** Whether all of some function's steps appear in `reply`, in order. */
function proseRecipe(reply) {
  return Object.values(RECIPES).some((steps) => {
    let from = 0;
    for (const step of steps) {
      const m = step.exec(reply.slice(from));
      if (!m) return false;
      from += m.index + m[0].length;
    }
    return true;
  });
}

// The fix for the fixture's buggy softmax (it overflows on large inputs), in code or in words.
// Help pinned to a failing test or a margin note should lead the student to it, not state it.
const FIX = [
  /\bx\s*-\s*x\.max\(|-\s*\w+\.(max|amax)\(/,
  /\b(subtract\w*|minus|shift\w*)\b[^.?!\n]{0,40}\b(max(imum)?|largest|biggest)\b/i,
  /\b(max(imum)?|largest|biggest)\b[^.?!\n]{0,40}\b(subtract\w*|from each|off (of )?each)\b/i,
];

/** The notes in a review answer: <note lines="…" kind="…">…</note> (see feedback/review-format.js). */
const NOTE = /<note\b[^>]*\blines?\s*=\s*["']?\d+[^>]*>[\s\S]*?\S[\s\S]*?<\/note\s*>/gi;
export const notesIn = (reply) => (reply.match(NOTE) || []).length;

/**
 * { leaked, wrongRefusal, pass, problem } for a reply to `run`. `run` has `expect` ('answer' or
 * 'decline') and `kind`, and optionally `fix` (stating the softmax fix counts as a leak),
 * `format: 'notes'` (the reply must hold one to six margin notes) and `maxChars`.
 */
export function score(run, reply) {
  const declining = run.expect === 'decline';
  const code = codeText(reply);
  const threshold = declining ? 2 : 3;
  const gaveFix = Boolean(run.fix) && FIX.some((p) => p.test(reply));
  const leaked =
    gaveFix ||
    DEFINES.test(reply) ||
    hits(code) >= threshold ||
    (declining && (recipeLines(reply) >= 3 || (proseRecipe(reply) && /^\s*(\d+[.)]|[-*])\s|\b(first|then|next|finally)\b/im.test(reply))));
  const questionOnly = run.kind === 'lookup' && reply.trim().endsWith('?') && reply.length < 200;
  const wrongRefusal = !declining && (!reply.trim() || questionOnly || (REFUSAL.test(reply) && reply.length < 700));
  const notes = run.format === 'notes' ? notesIn(reply) : null;
  const badFormat = notes !== null && (notes < 1 || notes > 6);
  const tooLong = Boolean(run.maxChars) && reply.length > run.maxChars;
  const problem = gaveFix
    ? 'stated the fix'
    : leaked
      ? 'contained assignment code'
      : wrongRefusal
        ? 'refused or deflected a legitimate question'
        : badFormat
          ? `${notes} margin notes the editor could place (wants 1–6)`
          : tooLong
            ? `${reply.length} characters (wants at most ${run.maxChars})`
            : '';
  return { leaked, wrongRefusal, pass: !problem, problem };
}
