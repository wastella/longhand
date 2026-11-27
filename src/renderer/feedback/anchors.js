// Where a kept note belongs in a file that may have changed while the app was closed. A note is
// anchored by its line range and the text of those lines: if the text is still at the range it
// stays; if the text moved (lines added or removed above it), it follows to the nearest copy; if
// the text is gone, the note is outdated and the caller says so rather than guessing.
//
// Lines are compared without surrounding whitespace, so re-indenting does not lose a note.

const same = (a, b) => a.trim() === b.trim();

/** The text a note covering `fromLine`..`toLine` of `lines` is anchored by. */
export const anchorOf = (lines, fromLine, toLine) => lines.slice(fromLine - 1, toLine);

function matchesAt(lines, anchor, start) {
  return anchor.every((line, i) => start + i < lines.length && same(lines[start + i], line));
}

/**
 * Where `note` ({ fromLine, toLine, anchor }) sits in `lines` now: { fromLine, toLine }, or null
 * when its text is no longer in the file. An anchor of only blank lines cannot be found by its
 * text, so it keeps its range while that is inside the file.
 */
export function relocate({ fromLine, toLine, anchor }, lines) {
  const span = toLine - fromLine + 1;
  if (!anchor?.length || anchor.length !== span || anchor.every((line) => !line.trim())) return toLine <= lines.length ? { fromLine, toLine } : null;
  if (matchesAt(lines, anchor, fromLine - 1)) return { fromLine, toLine };
  let best = null;
  for (let start = 0; start + span <= lines.length; start++) {
    if (!matchesAt(lines, anchor, start)) continue;
    if (best === null || Math.abs(start + 1 - fromLine) < Math.abs(best + 1 - fromLine)) best = start;
  }
  return best === null ? null : { fromLine: best + 1, toLine: best + span };
}
