// Finds what is worth clicking in a line of terminal output: file locations printed by Python
// tracebacks (File "path", line N), pytest and most tools (path:line, path::test) and web links.
// It runs on every hover, so every pattern is bounded and the work stays linear in the line.

/** Longer lines are only searched this far; output that long is not a traceback. */
const MAX_LINE = 16384;
const MAX_URL = 2048;

const PYTHON = /File "([^"\n]{1,1024})", line (\d{1,9})/g;
// A path with an extension, then :line[:col] or ::name. Lookbehind keeps it from starting inside
// a longer word or URL.
const PATH_LINE = /(?<![\w/.~-])((?:\.{1,2}\/|\/)?(?:[\w.-]{1,255}\/){0,32}[\w.-]{0,255}[\w-]\.[A-Za-z]\w{0,15})(?::(\d{1,9})(?::\d{1,9})?|::\w)/g;
const URL = new RegExp(`\\bhttps?://[^\\s"'<>\`]{1,${MAX_URL}}`, 'g');

const OPENING = { ')': '(', ']': '[', '}': '{' };

/** Drops punctuation that ends a sentence rather than the link, and unpaired closing brackets. */
function trimUrl(url) {
  const brackets = {};
  for (const char of url) if ('()[]{}'.includes(char)) brackets[char] = (brackets[char] || 0) + 1;
  let end = url.length;
  while (end > 0) {
    const last = url[end - 1];
    if ('.,;:!?\'"'.includes(last)) end--;
    else if (OPENING[last] && (brackets[OPENING[last]] || 0) < brackets[last]) {
      brackets[last]--;
      end--;
    } else break;
  }
  return url.slice(0, end);
}

/**
 * Everything clickable in `text`, in order, each as { start, end, ... } (string offsets, end
 * exclusive) plus either { path, line } (line may be null) or { url }.
 */
export function findLocations(text) {
  text = text.slice(0, MAX_LINE);
  const found = [];
  // Characters already inside a link, so a later pattern cannot claim part of one.
  const taken = new Uint8Array(text.length);
  const add = (link) => {
    if (taken.subarray(link.start, link.end).includes(1)) return;
    taken.fill(1, link.start, link.end);
    found.push(link);
  };
  for (const m of text.matchAll(URL)) {
    const url = trimUrl(m[0]);
    if (url.length > 'https://'.length) add({ start: m.index, end: m.index + url.length, url });
  }
  for (const m of text.matchAll(PYTHON)) {
    // Only the path is the link; 'File "' and the closing quote stay plain.
    const start = m.index + 'File "'.length;
    add({ start, end: start + m[1].length, path: m[1], line: Number(m[2]) });
  }
  for (const m of text.matchAll(PATH_LINE)) {
    add({ start: m.index, end: m.index + (m[2] ? m[0].length : m[1].length), path: m[1], line: m[2] ? Number(m[2]) : null });
  }
  return found.sort((a, b) => a.start - b.start);
}
