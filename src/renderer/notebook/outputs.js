// What a running cell's output becomes: the kernel's messages folded into nbformat outputs.
// Every change makes a new list (and a new object for the output that changed), so the model can
// tell what changed by identity.
//
// Stream text is kept as a terminal would show it: a carriage return goes back to the start of
// the line, so a progress bar (tqdm) redraws one line instead of filling the page and the file.
// A stream that grows past STREAM_LIMIT keeps its start and its end with a line saying how much
// was left out, so the notebook never balloons silently. A cell keeps at most OUTPUT_LIMIT
// outputs (a plot drawn in a loop makes one per pass): the oldest give way to a line saying how
// many were left out.

export const STREAM_LIMIT = 500_000;
export const OUTPUT_LIMIT = 200;
const HEAD = 100_000;

/** The marker left where stream text was cut. */
export const omittedLine = (lines) => `[… Longhand left out ${lines.toLocaleString('en-US')} ${lines === 1 ? 'line' : 'lines'} of this output here …]\n`;

/** The line standing for outputs left out, and how many it stands for. */
const leftOut = new WeakMap();
const leftOutNote = (count) => ({
  output_type: 'stream',
  name: 'stderr',
  text: `[… Longhand left out the first ${count.toLocaleString('en-US')} outputs of this cell; it keeps the last ${OUTPUT_LIMIT - 1} …]\n`,
});

/** How a cut stream continues: its fixed start, the lines left out so far and the end it keeps. */
const cuts = new WeakMap();

/**
 * Applies carriage returns and backspaces within each line. A line still ending in a carriage
 * return keeps it, so text that arrives next overwrites that line.
 */
export function overwrite(text) {
  if (!/[\r\b]/.test(text)) return text;
  return text
    .replace(/\r+\n/g, '\n')
    .split('\n')
    .map((line) => {
      if (!/[\r\b]/.test(line)) return line;
      const pending = line.endsWith('\r');
      let shown = '';
      for (const part of line.split('\r')) {
        let piece = '';
        for (const c of part) piece = c === '\b' ? piece.slice(0, -1) : piece + c;
        shown = piece + shown.slice(piece.length);
      }
      return pending ? shown + '\r' : shown;
    })
    .join('\n');
}

const countLines = (text) => (text.match(/\n/g) || []).length;

/** A stream output with `text` added, cut to STREAM_LIMIT. */
function grow(output, text) {
  const cut = cuts.get(output);
  if (!cut) {
    const all = overwrite(output.text + text);
    if (all.length <= STREAM_LIMIT) return { ...output, text: all };
    const headEnd = all.lastIndexOf('\n', HEAD) + 1 || HEAD;
    return trimmed(output, { head: all.slice(0, headEnd), omitted: 0, tail: all.slice(headEnd) });
  }
  return trimmed(output, { ...cut, tail: overwrite(cut.tail + text) });
}

function trimmed(output, { head, omitted, tail }) {
  const room = STREAM_LIMIT - HEAD;
  if (tail.length > room) {
    const from = tail.indexOf('\n', tail.length - room) + 1 || tail.length - room;
    omitted += countLines(tail.slice(0, from));
    tail = tail.slice(from);
  }
  const next = { ...output, text: head + (omitted ? omittedLine(omitted) : '') + tail };
  cuts.set(next, { head, omitted, tail });
  return next;
}

/**
 * The outputs after one output message from the kernel (`output` is nbformat-shaped). Text on
 * the same stream as the last output joins it, as Jupyter does.
 */
export function addOutput(outputs, output) {
  const last = outputs[outputs.length - 1];
  if (output.output_type === 'stream') {
    if (last?.output_type === 'stream' && last.name === output.name && !leftOut.has(last)) return [...outputs.slice(0, -1), grow(last, output.text)];
    return capped([...outputs, grow({ ...output, text: '' }, output.text)]);
  }
  return capped([...outputs, output]);
}

/** `outputs` with the oldest left out once there are more than OUTPUT_LIMIT. */
function capped(outputs) {
  if (outputs.length <= OUTPUT_LIMIT) return outputs;
  const before = leftOut.get(outputs[0]) ?? 0;
  const kept = outputs.slice(-(OUTPUT_LIMIT - 1));
  const count = before + outputs.length - kept.length - (before ? 1 : 0);
  const note = leftOutNote(count);
  leftOut.set(note, count);
  return [note, ...kept];
}

/** The outputs with every display whose id is `displayId` replaced by `output`'s data. */
export function updateDisplay(outputs, displayIds, displayId, output) {
  let changed = false;
  const next = outputs.map((o) => {
    if (displayIds.get(o) !== displayId) return o;
    changed = true;
    const updated = { ...o, data: output.data, metadata: output.metadata ?? o.metadata };
    displayIds.set(updated, displayId);
    return updated;
  });
  return changed ? next : outputs;
}
