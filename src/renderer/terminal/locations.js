// Finds what is worth clicking in a line of terminal output: file locations printed by Python
// tracebacks (File "path", line N), pytest and most tools (path:line, path::test) and web links.

const PYTHON = /File "([^"]+)", line (\d+)/g;
// A path with an extension, then :line[:col] or ::name. Lookbehind keeps it from starting inside
// a longer word or URL.
const PATH_LINE = /(?<![\w/.~-])((?:\.{1,2}\/|\/)?[\w.-]*[\w-](?:\/[\w.-]+)*\.[A-Za-z]\w*)(?::(\d+)(?::\d+)?|::\w)/g;
const URL = /\bhttps?:\/\/[^\s"'<>`]+/g;

/** Drops punctuation that ends a sentence rather than the link, and unpaired closing brackets. */
function trimUrl(url) {
  for (;;) {
    const last = url.at(-1);
    if ('.,;:!?\'"'.includes(last)) url = url.slice(0, -1);
    else if (')]}'.includes(last) && count(url, '([{'[')]}'.indexOf(last)]) < count(url, last)) url = url.slice(0, -1);
    else return url;
  }
}
const count = (text, char) => text.split(char).length - 1;

/**
 * Everything clickable in `text`, in order, each as { start, end, ... } (string offsets, end
 * exclusive) plus either { path, line } (line may be null) or { url }.
 */
export function findLocations(text) {
  const found = [];
  const overlaps = (start, end) => found.some((f) => start < f.end && f.start < end);
  for (const m of text.matchAll(URL)) {
    const url = trimUrl(m[0]);
    found.push({ start: m.index, end: m.index + url.length, url });
  }
  for (const m of text.matchAll(PYTHON)) {
    // The path and its line number are the link; 'File "' stays plain.
    const start = m.index + 'File "'.length;
    if (!overlaps(start, m.index + m[0].length)) found.push({ start, end: m.index + m[0].length, path: m[1], line: Number(m[2]) });
  }
  for (const m of text.matchAll(PATH_LINE)) {
    const end = m.index + (m[2] ? m[0].length : m[1].length);
    if (!overlaps(m.index, end)) found.push({ start: m.index, end, path: m[1], line: m[2] ? Number(m[2]) : null });
  }
  return found.sort((a, b) => a.start - b.start);
}
