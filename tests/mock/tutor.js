// A tutor that reads a file and then answers. Questions containing "include code" or
// "be hostile" get answers that exercise the hidden-code check and the sanitizer.
// window.__asked records every prompt sent.

const mock = window.__mock;
window.__asked = [];
let generation = 0;

const answers = {
  default: [
    'Your `variance` divides by the right thing, so look at what `push` accumulates.',
    '',
    'Try it by hand on the stream 2, 4, 6. After each `push`, write down `mean` and `sum_sq`, and compare `sum_sq` with the sum of squared distances from the *final* mean, which is 8.',
    '',
    'One question to check your reading of lines 12–14: when you compute `delta`, which mean is it measured from, and has that mean moved by the time you square it?',
  ].join('\n'),
  code: 'Run this:\n\n```bash\nuv run pytest\n```\n\nAn analogous example:\n\n```python\ndef push(self, x):\n    self.total += x\n    self.count += 1\n```',
  hostile:
    'Hi <script>window.__pwned = 1</script><img src=x onerror="window.__pwned = 1"> [link](https://example.com) [bad](javascript:window.__pwned=1) <iframe src="https://example.com"></iframe>',
};

function answerFor(prompt) {
  if (prompt.includes('include code')) return answers.code;
  if (prompt.includes('be hostile')) return answers.hostile;
  return answers.default;
}

Object.assign(mock.commands, {
  tutor_ask: ({ prompt, kind }) => {
    const gen = ++generation;
    window.__asked.push({ prompt, kind });
    const send = (ms, event) => setTimeout(() => mock.emit('tutor:event', { gen, ...event }), ms);
    send(20, { type: 'tool', name: 'Read', target: `${mock.workspace.path}/stats/running.py` });
    send(60, { type: 'text', text: answerFor(prompt) });
    send(100, { type: 'done' });
    return gen;
  },
});
