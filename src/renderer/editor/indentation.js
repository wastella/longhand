// Working out how a file is already indented, so new lines match it.

// Enough lines to see a file's style without scanning a large one end to end.
const SAMPLE_LINES = 2000;

/**
 * The indent unit `text` uses: a tab, or the step between the space-indented lines that
 * appears most often. `fallback` when the file has no indented lines to go by.
 */
export function detectIndent(text, fallback) {
  let tabs = 0;
  let spaced = 0;
  let previous = 0;
  const steps = new Map();
  for (const line of text.split('\n', SAMPLE_LINES)) {
    if (!line.trim()) continue;
    if (line[0] === '\t') {
      tabs++;
      continue;
    }
    const width = line.length - line.trimStart().length;
    if (width) spaced++;
    const step = Math.abs(width - previous);
    if (step >= 2 && step <= 8) steps.set(step, (steps.get(step) || 0) + 1);
    previous = width;
  }
  if (tabs > spaced) return '\t';
  if (!steps.size) return fallback;
  const [step] = [...steps].reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  return ' '.repeat(step);
}
