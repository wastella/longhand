// Guessing which file in a newly opened folder is the assignment's handout: a PDF or Markdown
// file at the top of the folder whose name says so (handout, assignment, writeup, spec,
// instructions), else the README.

import { canBeHandout, viewKind } from './files.js';

// Whole words only, so inspect.md or prospectus.pdf is not a "spec". A word ends at anything but
// a letter: hw1_handout.pdf, Assignment1.pdf and cs336-spec.md all match.
const NAMED = /(?:^|[^a-z])(?:handouts?|assignments?|write-?ups?|specs?|specification|instructions)(?![a-z])/i;
const README = /^readme\.(md|markdown)$/i;

const isPdf = (entry) => viewKind(entry.path) === 'pdf';

/**
 * The likely handout among `entries` (the folder's top level, as fs_list gives it):
 * { path, named }, where `named` says the name itself marks it as the handout; or null.
 */
export function guessHandout(entries) {
  const files = entries.filter((entry) => !entry.dir && !entry.ignored && canBeHandout(entry.path));
  // A PDF first: when a course ships both, the PDF is the handout and the Markdown its notes.
  const named = files.filter((entry) => NAMED.test(entry.name)).sort((a, b) => isPdf(b) - isPdf(a) || a.name.localeCompare(b.name));
  if (named.length) return { path: named[0].path, named: true };
  const readme = files.find((entry) => README.test(entry.name));
  return readme ? { path: readme.path, named: false } : null;
}
