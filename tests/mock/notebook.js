// A pretend kernel for notebooks (notebook.rs and its Python helper). It answers code by pattern:
//   print('text')     prints text            1/0          raises ZeroDivisionError
//   while True:       runs until interrupted input('Name? ') fails, as the helper makes it
//   os._exit(0)       the kernel dies         plot()       shows a PNG
//   progress()        a tqdm-like bar         spam(n)      prints n lines
//   displays(n)       shows n plots, one message each
//   anything else whose last line is an expression shows it as the result
// Options: notebookProblem: { kind, title, detail, fix } makes the helper end without starting
// the kernel (as with ipykernel missing); notebookStartError makes notebook_start fail.
// Hooks for tests: window.__kernel { started: [id], sent: [{ id, message }], stopped: [id],
// acked }, and window.__kernelSay(message) sends a helper message to the latest kernel.

const mock = window.__mock;
const kernel = (window.__kernel = { started: [], sent: [], stopped: [], acked: 0 });
const live = new Map();
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function say(id, message) {
  if (!live.has(id)) return;
  mock.emit('notebook:message', { id, message, bytes: JSON.stringify(message).length });
}
window.__kernelSay = (message) => say(kernel.started[kernel.started.length - 1], message);

function end(id, exit) {
  if (!live.has(id)) return;
  live.delete(id);
  mock.emit('notebook:exit', { id, code: 0, signal: null, problem: null, ...exit });
}

const literal = (line) => /\(\s*['"](.*)['"]\s*\)/.exec(line)?.[1] ?? '';

/** Runs `code` as the pretend kernel would, then says the run is done. */
async function execute(id, run, code) {
  const k = live.get(id);
  const seq = ++k.sent;
  // One cell at a time, like a real kernel, which aborts the cells sent before an error ended.
  k.queue = k.queue.then(async () => {
    if (!live.has(id)) return;
    if (seq <= k.abortUpTo) return say(id, { type: 'done', run, status: 'aborted', count: null });
    k.count += 1;
    const count = k.count;
    say(id, { type: 'status', state: 'busy' });
    say(id, { type: 'start', run, count });
    const out = (output) => say(id, { type: 'output', run, output });
    const done = (status) => {
      // As the helper does: the kernel goes idle, then the run's reply arrives.
      say(id, { type: 'status', state: 'idle' });
      say(id, { type: 'done', run, status, count });
    };
    const lines = code.split('\n');
    for (const line of lines) {
      if (/^\s*print\(/.test(line)) out({ output_type: 'stream', name: 'stdout', text: literal(line) + '\n' });
      if (line.includes('1/0')) {
        out({
          output_type: 'error',
          ename: 'ZeroDivisionError',
          evalue: 'division by zero',
          traceback: [
            '\u001b[31mZeroDivisionError\u001b[39m                         Traceback (most recent call last)',
            'Cell \u001b[32mIn[1]\u001b[39m, line 1',
            '\u001b[31mZeroDivisionError\u001b[39m: division by zero',
          ],
        });
        k.abortUpTo = k.sent;
        return done('error');
      }
      if (line.includes('while True')) {
        await new Promise((resolve) => (k.interrupt = resolve));
        out({ output_type: 'error', ename: 'KeyboardInterrupt', evalue: '', traceback: ['\u001b[31mKeyboardInterrupt\u001b[39m: '] });
        return done('error');
      }
      if (line.includes('input(')) {
        const said = 'This cell asked for input, which notebooks in Longhand cannot give. Set the value in the code instead.';
        out({ output_type: 'error', ename: 'StdinNotImplementedError', evalue: said, traceback: [said] });
        return done('error');
      }
      if (line.includes('os._exit')) return end(id, { kernel: { code: 0, signal: null } });
      if (line.includes('plot()'))
        out({ output_type: 'display_data', data: { 'image/png': PNG, 'text/plain': '<Figure size 640x480 with 1 Axes>' }, metadata: {} });
      if (line.includes('progress()'))
        for (let i = 0; i <= 10; i++) out({ output_type: 'stream', name: 'stderr', text: `\r${i * 10}%|${'█'.repeat(i)}${' '.repeat(10 - i)}| ${i}/10` });
      const displays = /displays\((\d+)\)/.exec(line);
      if (displays)
        for (let i = 0; i < Number(displays[1]); i++)
          out({ output_type: 'display_data', data: { 'image/png': PNG, 'text/plain': `<Figure ${i + 1}>` }, metadata: {} });
      const spam = /spam\((\d+)\)/.exec(line);
      if (spam) out({ output_type: 'stream', name: 'stdout', text: Array.from({ length: Number(spam[1]) }, (_, i) => `line ${i + 1}\n`).join('') });
    }
    const last = lines[lines.length - 1].trim();
    if (last && !/^(print|import|def |for |while |if |os\.|plot|progress|spam|input|#)/.test(last) && !last.includes('='))
      out({ output_type: 'execute_result', execution_count: count, data: { 'text/plain': last }, metadata: {} });
    done('ok');
  });
}

Object.assign(mock.commands, {
  notebook_start: ({ id }) => {
    if (mock.options.notebookStartError) throw mock.options.notebookStartError;
    kernel.started.push(id);
    live.set(id, { count: 0, sent: 0, abortUpTo: 0, queue: Promise.resolve(), interrupt: null });
    setTimeout(() => {
      if (mock.options.notebookProblem) return end(id, { code: 1, problem: mock.options.notebookProblem });
      say(id, { type: 'ready', python: '3.12.4' });
    }, 30);
  },
  notebook_send: ({ id, message }) => {
    kernel.sent.push({ id, message });
    const k = live.get(id);
    if (!k) throw 'The kernel is not running';
    if (message.op === 'execute') execute(id, message.run, message.code);
    if (message.op === 'interrupt') k.interrupt?.();
  },
  notebook_ack: ({ bytes }) => (kernel.acked += bytes),
  // Stopping takes a moment, as the real one does (it waits for the processes to end).
  notebook_stop: async ({ id }) => {
    kernel.stopped.push(id);
    live.delete(id);
    await new Promise((resolve) => setTimeout(resolve, 50));
  },
});
