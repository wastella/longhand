// Which file a newly opened folder offers as its handout (viewer/find.js), without a browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guessHandout } from '../../src/renderer/viewer/find.js';

const entries = (...names) => names.map((name) => ({ name, path: name, dir: name.endsWith('/') }));
const guess = (...names) => guessHandout(entries(...names));

test('names that say handout, assignment, writeup, spec or instructions, as whole words', () => {
  for (const name of [
    'handout.pdf',
    'hw1_handout.pdf',
    'Assignment1.pdf',
    'cs336-spec.md',
    'write-up.md',
    'WRITEUP.MD',
    'Instructions.markdown',
    'specification.pdf',
  ])
    assert.deepEqual(guess(name, 'main.py'), { path: name, named: true }, name);
});

test('a word that only contains one of them is not a handout', () => {
  for (const name of ['inspect.md', 'prospectus.pdf', 'respect.md', 'myhandoutnotes.md', 'reassignment.pdf']) assert.equal(guess(name), null, name);
});

test('a PDF comes first, whatever the case of its extension', () => {
  assert.deepEqual(guess('assignment.md', 'ASSIGNMENT.PDF'), { path: 'ASSIGNMENT.PDF', named: true });
});

test('the README is the fallback, not offered as named; other files and folders are never guessed', () => {
  assert.deepEqual(guess('README.md', 'notes.txt'), { path: 'README.md', named: false });
  assert.equal(guess('handout.txt', 'handout/', 'spec.png'), null);
});
