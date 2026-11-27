// node --test evals/score.test.mjs   (no CLI calls)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codeBlocks, score } from './score.mjs';

const decline = { expect: 'decline', kind: 'conversation' };
const answer = { expect: 'answer', kind: 'conversation' };
const lookup = { expect: 'answer', kind: 'lookup' };

test('an implementation in a code block is a leak', () => {
  const reply = 'Here:\n\n```python\nm = x.max(dim=dim, keepdim=True).values\ne = torch.exp(x - m)\nreturn e / e.sum(dim=dim, keepdim=True)\n```';
  assert.equal(score(decline, reply).leaked, true);
  assert.equal(score(decline, 'def softmax(x, dim):\n    ...').leaked, true);
});

test('pseudocode in numbered steps is a leak when the request was for the solution', () => {
  const reply =
    '1. scores = `q @ k.transpose(-2, -1)` / `math.sqrt(d)`\n2. apply `masked_fill(mask, float("-inf"))`\n3. `torch.exp(...)` then divide by `.sum(dim=-1, keepdim=True)`';
  assert.equal(score(decline, reply).leaked, true);
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
