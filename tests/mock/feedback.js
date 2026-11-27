// The tutor's margin notes (src-tauri/src/feedback.rs), kept in memory, and the answers the
// mock tutor gives to reviews, explanations and failing tests.
//
// Options (window.__MOCK__.feedback):
//   notes    the folder's kept notes to start with ([{ id, path, fromLine, toLine, anchor, … }])
//   review   'three' (default), 'six', 'malformed', 'prose', or an answer (string, or array of
//            chunks) for a review
// window.__notes holds the kept notes as last saved; window.__noteSaves counts the saves.

const mock = window.__mock;
// Read when used, so a test can change them between requests.
const options = () => mock.options.feedback || {};
window.__notes = structuredClone(options().notes || []);
window.__noteSaves = 0;

const note = (lines, kind, text) => `<note lines="${lines}" kind="${kind}">\n${text}\n</note>\n`;

const reviews = {
  // For stats/running.py in the fixture.
  three: [
    note('5-8', 'good', 'Three running totals and no list: this is what makes it a stream, and it keeps memory constant however long the input.'),
    note(
      '12-14',
      'question',
      'You update `mean` before adding to `sum_sq`. Write out the first two pushes by hand: is `delta` still the distance that `sum_sq` needs?',
    ),
    note('17-18', 'question', 'What should the variance of a single number be, and does the test agree?'),
  ],
  six: [
    note(
      '1',
      'clarity',
      'The docstring says what the module is for in one line. A sentence on which variance (sample or population) would save a reader a guess.',
    ),
    note('5-8', 'good', 'Three running totals and no list: this is what makes it a stream, and it keeps memory constant however long the input.'),
    note('11', 'good', 'Counting first means `self.count` is never zero below it, so the division on line 13 is safe.'),
    note('12-14', 'bug', 'For the stream 2, 4, 6 this ends with `sum_sq` at 12, while the sum of squared distances from the final mean is 8.'),
    note(
      '16-19',
      'fragile',
      'This works for the tests, but nothing says whether a caller gets the sample or the population variance; one more test with two numbers would pin it down.',
    ),
    note('17-18', 'question', 'What should the variance of a single number be, and does the test agree?'),
  ],
  malformed: [
    'Here are my notes.\n\n',
    note('12-14', 'question', 'A good note that should be placed.'),
    note('0', 'bug', 'Line zero does not exist.'),
    note('15-12', 'bug', 'A range that runs backwards.'),
    note('400', 'bug', 'Past the end of the file.'),
    '<note kind="bug">No lines at all.</note>\n',
    note('3', 'question', '   '),
    note('17', 'nonsense', 'An unknown kind <img src=x onerror="window.__pwned=1"> becomes a question, and markup is sanitized.'),
    '<note lines="19" kind="bug">Never closed, so never placed.',
  ],
  prose: 'Overall this looks fine. The update in push is worth a second look.',
};

const explanation =
  'Each call to `push` takes one new number. It counts it, measures how far it is from the mean so far (`delta`), moves the mean a fraction of that distance, and adds `delta` squared to `sum_sq`.';
const coaching =
  'The assertion compared `s.variance()` with 4.0 and got 6.0: 1.5 times too big. Push 2, 4 and 6 by hand and print `sum_sq` after each push. Which push makes it grow more than the squared distance you expected?';
const orientation =
  '`run_linear` is the first layer of the model: it maps `d_in` features to `d_out`. The test feeds it known weights and compares the output shape and values. Read the handout section on linear layers and einsum notation first.';
const confirmation = 'Yes: `delta` was measured from the old mean, so the squares were too large. Updating the mean first changes what `delta` means.';

mock.answerHooks = [
  ...(mock.answerHooks || []),
  ({ kind, prompt, about }) => {
    if (/include code|be hostile|smuggle|math/.test(prompt) && about !== 'review') return null;
    if (kind === 'review' && about === 'review') {
      const chosen = options().review || 'three';
      return reviews[chosen] || chosen;
    }
    if (about === 'explain' && prompt.includes('Explain what')) return explanation;
    if (about === 'checkpoint') return confirmation;
    if (kind === 'failure' && prompt.includes('Where do I start?')) return orientation;
    if (kind === 'failure' && !prompt.includes('failure changed')) return coaching;
    return null;
  },
];

Object.assign(mock.commands, {
  feedback_notes_load: () => structuredClone(window.__notes),
  feedback_notes_save: ({ notes }) => {
    window.__notes = structuredClone(notes);
    window.__noteSaves++;
  },
});
