// A tutor that reads a file and then answers, on independent threads kept in memory. Questions
// containing certain words get answers that exercise the interface:
//   "include code"  a shell block and a Python block (the hidden-code check)
//   "be hostile"    markup that must be sanitized away
//   "math"          inline and display formulas; "math hostile" tries to inject through them
//   "long answer"   many paragraphs, streamed slowly (scrolling, Stop)
//   "torch.tril"    the lookup answer
// Options (window.__MOCK__.tutor): threads { id: thread } to start with, failures [{ code,
// message, resetsAt }] for the next requests to end with, refuse { code, message } for every
// request to be refused outright, pastDays [day] for the record.
// window.__asked records every request; window.__prepared counts warm starts.

const mock = window.__mock;
const options = mock.options.tutor || {};
const threads = (window.__threads = structuredClone(options.threads || {}));
const failures = [...(options.failures || [])];
const running = new Map();
let reveals = 0;
window.__asked = [];
window.__prepared = 0;

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
  math: [
    'Softmax turns scores into probabilities: $\\mathrm{softmax}(x)_i = \\frac{e^{x_i}}{\\sum_j e^{x_j}}$, and it costs $5 to $10 of nothing.',
    '',
    'Cross-entropy for a target class $y$ is',
    '',
    '$$\\mathcal{L} = -\\log \\frac{e^{z_y}}{\\sum_j e^{z_j}}$$',
    '',
    'Keep `$HOME` in code as it is.',
  ].join('\n'),
  mathHostile: [
    '$\\href{javascript:window.__pwned=1}{click}$ and $\\url{javascript:window.__pwned=1}$',
    '',
    '$x</span><img src=x onerror="window.__pwned=1">$ and $\\htmlStyle{position:fixed;inset:0}{x}$',
    '',
    '$$\\style{background:url(https://example.com/x)}{y} \\htmlClass{pwn}{z} \\includegraphics{https://example.com/a.png}$$',
    '',
    '<span data-math="0" style="position:fixed">spoof</span>',
  ].join('\n'),
  long: Array.from(
    { length: 30 },
    (_, i) => `Paragraph ${i + 1}: the gradient of the loss with respect to the logits is the softmax minus the one-hot target.`,
  ).join('\n\n'),
  lookup: '`torch.tril(input, diagonal=0)` returns a copy of `input` with everything above the diagonal set to zero.',
  // Ways to carry code past the hidden-code check ("smuggle <way>"), and one table that is not code.
  smuggle: {
    texttt: '$$\\begin{array}{l}\\texttt{def f(q, k, v):}\\\\ \\texttt{\\ \\ s = q @ k.T}\\\\ \\texttt{\\ \\ return s.softmax(-1) @ v}\\end{array}$$',
    verb: '$$\\begin{matrix}\\verb|m = x.max(-1)| \\\\ \\verb|e = (x - m).exp()| \\\\ \\verb|return e / e.sum()|\\end{matrix}$$',
    split:
      'First:\n\n```python\nm = x.max(dim=-1, keepdim=True).values\n```\n\nThen:\n\n```python\ne = torch.exp(x - m)\n```\n\nFinally:\n\n```python\nreturn e / e.sum(dim=-1, keepdim=True)\n```',
    bash: '```bash\ndef softmax(x, dim):\n    m = x.max(dim=dim, keepdim=True).values\n    return torch.exp(x - m) / torch.exp(x - m).sum(dim=dim, keepdim=True)\n```',
    table:
      '| step | code |\n| --- | --- |\n| 1 | `m = x.max(dim=-1, keepdim=True).values` |\n| 2 | `e = torch.exp(x - m)` |\n| 3 | `e / e.sum(dim=-1, keepdim=True)` |',
    breaks: '`m = x.max(-1).values`  \n`e = torch.exp(x - m)`  \n`out = e / e.sum(-1)`',
    raw: 'Here: <code>m = x.max(-1).values<br>e = torch.exp(x - m)<br>return e / e.sum(-1)</code>',
    api: '| call | returns |\n| --- | --- |\n| `torch.tril(input, diagonal=0)` | the lower triangle |\n| `torch.triu(input, diagonal=0)` | the upper triangle |\n| `Tensor.masked_fill(mask, value)` | a filled copy |',
  },
  raisebox: 'Before $\\raisebox{60em}{X}\\rule{200em}{3em}\\kern{-90em}Y$ after.',
};

function answerFor(prompt) {
  const smuggled = prompt.match(/smuggle (\w+)/);
  if (smuggled) return answers.smuggle[smuggled[1]];
  if (prompt.includes('raisebox')) return answers.raisebox;
  if (prompt.includes('include code')) return answers.code;
  if (prompt.includes('be hostile')) return answers.hostile;
  if (prompt.includes('math hostile')) return answers.mathHostile;
  if (prompt.includes('math')) return answers.math;
  if (prompt.includes('long answer')) return answers.long;
  if (prompt.includes('torch.tril')) return answers.lookup;
  return answers.default;
}

const now = () => new Date().toISOString();

function keep(request, message) {
  if (request.ephemeral) return;
  const thread = (threads[request.thread] ||= { id: request.thread, kind: request.kind, title: '', created: now(), updated: now(), messages: [] });
  thread.messages.push({ at: now(), ...message });
  thread.title ||= thread.messages.find((m) => m.role === 'student')?.text.split('\n')[0] || '';
  thread.updated = now();
}

function stop(thread) {
  const run = running.get(thread);
  if (!run) return;
  run.timers.forEach(clearTimeout);
  running.delete(thread);
  keep(run.request, { role: 'tutor', text: run.text, status: 'stopped' });
  mock.emit('tutor:event', { thread, request: run.request.id, type: 'done', cancelled: true });
}

function start(request) {
  const { thread, id } = request;
  stop(thread);
  const run = { request, text: '', timers: [] };
  running.set(thread, run);
  const send = (ms, event, then) =>
    run.timers.push(
      setTimeout(() => {
        then?.();
        mock.emit('tutor:event', { thread, request: id, ...event });
      }, ms),
    );
  const failure = failures.shift();
  if (failure) return send(30, { type: 'error', ...failure }, () => (running.delete(thread), keep(request, { role: 'tutor', text: '', status: 'error' })));
  const text = answerFor(request.prompt);
  const slow = request.prompt.includes('long answer');
  const chunks = slow ? text.split(/(?<=\n\n)/) : [text];
  if (request.kind !== 'lookup') send(20, { type: 'tool', name: 'Read', target: `${mock.workspace.path}/stats/running.py` });
  chunks.forEach((chunk, i) => send(slow ? 60 + i * 50 : 60, { type: 'text', text: chunk }, () => (run.text += chunk)));
  send((slow ? 60 + chunks.length * 50 : 60) + 40, { type: 'done' }, () => (running.delete(thread), keep(request, { role: 'tutor', text: run.text })));
}

// The questions the fixture's log already holds for today, so the title bar's count and the
// record's Today agree, as they do in the app (both are read from the same log).
const earlierToday = mock.workspace.log?.today?.ask || 0;

function today() {
  const asks = earlierToday ? { question: earlierToday } : {};
  let hintRung = 0;
  for (const r of window.__asked) {
    const about = r.about || (r.kind === 'conversation' ? 'question' : r.kind);
    asks[about] = (asks[about] || 0) + 1;
    hintRung = Math.max(hintRung, r.rung || 0);
  }
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { date, asks, hintRung, reveals };
}

/** The title bar's counts, from the same requests and reveals as the record. */
function summary() {
  const tests = mock.workspace.log?.today?.tests || 0;
  const counts = { ask: earlierToday + window.__asked.length, reveal: reveals, tests };
  return { today: counts, total: counts };
}

Object.assign(mock.commands, {
  tutor_request: ({ request }) => {
    window.__asked.push(request);
    if (options.refuse) throw options.refuse;
    if (!request.retry) keep(request, { role: 'student', text: request.question || request.prompt, context: request.context || [] });
    start(request);
  },
  tutor_cancel: ({ thread, request }) => {
    for (const [id, run] of [...running]) if ((!thread || id === thread) && (!request || run.request.id === request)) stop(id);
  },
  tutor_prepare: () => void window.__prepared++,
  tutor_threads: ({ prefix }) =>
    Object.values(threads)
      .filter((t) => t.id.startsWith(prefix) && t.messages.length)
      .sort((a, b) => b.updated.localeCompare(a.updated))
      .map((t) => ({ id: t.id, kind: t.kind, title: t.title, updated: t.updated, messages: t.messages.length })),
  tutor_thread: ({ id }) => structuredClone(threads[id] || null),
  tutor_record: () => {
    const days = [today(), ...(options.pastDays || [])].filter((d) => Object.keys(d.asks).length || d.reveals);
    const total = { asks: {}, hintRung: 0, reveals: 0 };
    for (const d of days) {
      for (const [k, n] of Object.entries(d.asks)) total.asks[k] = (total.asks[k] || 0) + n;
      total.hintRung = Math.max(total.hintRung, d.hintRung);
      total.reveals += d.reveals;
    }
    return { days, total };
  },
  log_summary: summary,
  log_record: (args) => {
    if (args.kind === 'reveal') reveals++;
    window.__logged = [...(window.__logged || []), args];
    return summary();
  },
});
