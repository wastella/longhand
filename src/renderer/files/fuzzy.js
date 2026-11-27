// Fuzzy matching for quick open. A query matches a path when its characters appear in order.
// Matches in the file name rank above matches that need the folders; within each, contiguous
// matches and matches at the start of words rank higher, and shorter paths break ties.

const SEPARATORS = '/_-. ';

/** A path prepared once, so each keystroke only compares. */
export function candidate(path) {
  return { path, lower: path.toLowerCase(), base: path.lastIndexOf('/') + 1 };
}

function isBoundary(path, i, start) {
  if (i === start) return true;
  const before = path[i - 1];
  if (SEPARATORS.includes(before)) return true;
  // camelCase: a capital after a small letter starts a word.
  return path[i] !== path[i].toLowerCase() && before === before.toLowerCase() && before !== before.toUpperCase();
}

/** Positions of `query` in `lower` from `start`, preferring a contiguous run, or null. */
function locate(c, query, start) {
  let at = c.lower.indexOf(query, start);
  if (at >= 0) {
    // Prefer an occurrence that starts a word, if there is one.
    for (let next = at; next >= 0; next = c.lower.indexOf(query, next + 1)) {
      if (isBoundary(c.path, next, start)) {
        at = next;
        break;
      }
    }
    return Array.from(query, (_, i) => at + i);
  }
  const positions = [];
  let from = start;
  for (const ch of query) {
    const i = c.lower.indexOf(ch, from);
    if (i < 0) return null;
    positions.push(i);
    from = i + 1;
  }
  return positions;
}

function rate(c, positions, start) {
  let score = 0;
  positions.forEach((p, i) => {
    score += 1;
    if (i > 0 && p === positions[i - 1] + 1) score += 6;
    else if (i > 0) score -= Math.min(p - positions[i - 1], 8) * 0.5;
    if (isBoundary(c.path, p, start)) score += 8;
  });
  if (positions[0] === start) score += 15;
  return score;
}

/**
 * Scores `c` (from `candidate`) against a lowercased query without spaces. Returns
 * { score, positions } with the matched character positions, or null when it does not match.
 */
export function match(c, query) {
  if (!query) return { score: 0, positions: [] };
  // A query with a slash is about folders, so it is matched against the whole path.
  if (!query.includes('/')) {
    const positions = locate(c, query, c.base);
    if (positions) {
      const name = c.lower.slice(c.base);
      const exact = name === query || name.startsWith(query + '.') ? 50 : 0;
      return { score: 2000 + exact + rate(c, positions, c.base) - c.path.length * 0.1, positions };
    }
  }
  const positions = locate(c, query, 0);
  if (!positions) return null;
  return { score: 1000 + rate(c, positions, 0) - c.path.length * 0.1, positions };
}

/** Turns what the student typed into the form `match` expects. */
export const normalise = (typed) => typed.toLowerCase().replace(/\s+/g, '');
