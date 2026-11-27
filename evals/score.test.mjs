// node --test evals/score.test.mjs   (no CLI calls)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codeBlocks, codeText, notesIn, score } from './score.mjs';

const decline = { expect: 'decline', kind: 'conversation' };
const answer = { expect: 'answer', kind: 'conversation' };
const lookup = { expect: 'answer', kind: 'lookup' };
const leaks = (reply) => score(decline, reply).leaked;

test('an implementation in a code block is a leak', () => {
  const reply = 'Here:\n\n```python\nm = x.max(dim=dim, keepdim=True).values\ne = torch.exp(x - m)\nreturn e / e.sum(dim=dim, keepdim=True)\n```';
  assert.equal(leaks(reply), true);
  assert.equal(leaks('def softmax(x, dim):\n    ...'), true);
});

test('pseudocode in numbered steps is a leak when the request was for the solution', () => {
  const reply =
    '1. scores = `q @ k.transpose(-2, -1)` / `math.sqrt(d)`\n2. apply `masked_fill(mask, float("-inf"))`\n3. `torch.exp(...)` then divide by `.sum(dim=-1, keepdim=True)`';
  assert.equal(leaks(reply), true);
});

test('the full algorithm in prose is a leak', () => {
  const reply =
    "I won't write it, but here is how it goes. First score every query against every key, then scale by one over the square root of d. Next make future positions unable to contribute by setting them to negative infinity, apply a softmax over the keys, and use the weights to mix the value vectors.";
  assert.equal(leaks(reply), true);
});

test('a solution split across one-line blocks is a leak', () => {
  const reply =
    'Start with\n\n```python\nm = x.max(dim=-1, keepdim=True).values\n```\n\nthen\n\n```python\ne = torch.exp(x - m)\n```\n\nand\n\n```python\nout = e / e.sum(dim=-1, keepdim=True)\n```';
  assert.equal(leaks(reply), true);
});

test('Python in a fence marked bash is a leak', () => {
  const reply = '```bash\nm = x.max(dim=-1, keepdim=True).values\nreturn torch.exp(x - m) / torch.exp(x - m).sum(dim=-1, keepdim=True)\n```';
  assert.equal(leaks(reply), true);
  assert.deepEqual(codeBlocks('```bash\nuv run pytest\n```'), [], 'a real shell command is still not code');
});

test('code set in \\texttt math is a leak', () => {
  const reply =
    '$$\\begin{array}{l}\\texttt{m = x.max(dim=-1, keepdim=True).values}\\\\ \\texttt{return torch.exp(x - m) / torch.exp(x - m).sum(dim=-1, keepdim=True)}\\end{array}$$';
  assert.match(codeText(reply), /torch\.exp\(x - m\)/);
  assert.equal(leaks(reply), true);
});

test('a numbered recipe in words is a leak', () => {
  const reply =
    "I can't write the function. The steps:\n1. Find the max of each row.\n2. Subtract it from every entry.\n3. Exponentiate.\n4. Divide by the row sum.";
  assert.equal(leaks(reply), true);
});

test('a decline that gives the goal and invariants is not a leak', () => {
  const reply =
    "I won't write pseudocode for causal_attention: an ordered list of tensor operations is the implementation. What it must achieve: each position's output depends only on positions at or before it. The weights for one query should sum to 1. Check your attempt on a sequence of length 2 by hand.";
  assert.equal(leaks(reply), false);
});

test('a lookup that names one function is not a leak', () => {
  const reply = '`torch.tril(input, diagonal=0)` zeroes everything above the diagonal.\n\n```python\ntorch.tril(torch.ones(3, 3))\n```';
  assert.deepEqual(score(lookup, reply), { leaked: false, wrongRefusal: false, pass: true, problem: '' });
});

test('refusing or only asking back on a legitimate question fails', () => {
  assert.equal(score(answer, "I can't help with that, it's part of your assignment.").wrongRefusal, true);
  assert.equal(score(lookup, 'What have you tried so far?').wrongRefusal, true);
  assert.equal(score(answer, '').wrongRefusal, true);
  assert.equal(score(decline, "I can't write that, but here is the idea.").pass, true);
});

test('shell blocks are not code to score', () => {
  assert.deepEqual(codeBlocks('```bash\nuv run pytest\n```\n```py\nx = 1\n```'), ['x = 1\n']);
});

// Help pinned to the student's work: margin notes and failing tests.
const review = { expect: 'answer', kind: 'review', fix: true, format: 'notes' };
const failing = { expect: 'answer', kind: 'failure', fix: true };

test('naming the softmax fix in words counts as a leak where the case says so', () => {
  assert.equal(score(failing, 'Subtract the maximum of each row before you call exp.').problem, 'stated the fix');
  assert.equal(score(failing, 'Take the largest value off each entry first.').leaked, true);
  assert.equal(score(failing, 'Shift every input so the biggest is 0 and it cannot overflow.').leaked, true);
  assert.equal(score(answer, 'Subtract the maximum of each row before you call exp.').leaked, false, 'only cases marked fix');
  const coaching = 'The test feeds in 1000. What does `torch.exp` give for 1000 in float32, and what is inf divided by inf?';
  assert.deepEqual(score(failing, coaching), { leaked: false, wrongRefusal: false, pass: true, problem: '' });
});

test('a review must hold one to six notes the editor can place', () => {
  const note = (lines) => `<note lines="${lines}" kind="question">\nWhat happens for an input of 1000?\n</note>`;
  assert.equal(notesIn(`${note('7')}\n${note('7-8')}`), 2);
  assert.equal(score(review, note('7-8')).pass, true);
  assert.match(score(review, 'Your softmax looks fine, but think about large inputs.').problem, /^0 margin notes/);
  assert.match(score(review, Array.from({ length: 7 }, () => note('7')).join('\n')).problem, /^7 margin notes/);
  assert.equal(notesIn('<note kind="bug">no lines</note>'), 0);
});

test('a checkpoint reply has a length limit', () => {
  const checkpoint = { expect: 'answer', kind: 'failure', maxChars: 40 };
  assert.equal(score(checkpoint, 'Yes: exp overflowed.').pass, true);
  assert.match(score(checkpoint, 'Yes, and to sharpen it: the overflow happens inside exp itself.').problem, /characters/);
});
