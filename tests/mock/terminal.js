// Terminals that print a prompt and record what they are sent. Each turns bracketed paste on,
// as zsh does.
//
// Hooks for tests: window.__term holds { started: [id], input: { id: [data] }, resized, closed,
// acked: { id: bytes }, calls: ['reset' | 'start' | 'output <id>' | 'input <id>'] }, and window.__termWrite(text, index = 0)
// prints to a terminal.
// Options: `termOutput` replaces what the first terminal prints after its prompt; `termBusy`
// lists the command running in each terminal, by start order ('' for an unnamed one, null for
// idle); `termStartError` makes term_start fail with that message.

const mock = window.__mock;
const prompt = '\x1b[2mrunning-stats\x1b[0m % ';
const term = (window.__term = { started: [], input: {}, resized: [], closed: [], acked: {}, calls: [] });
function write(id, data) {
  term.calls.push(`output ${id}`);
  mock.emit('term:data', { id, data, bytes: new TextEncoder().encode(data).length });
}
window.__termWrite = (text, index = 0) => write(term.started[index], text);

const live = () => term.started.filter((id) => !term.closed.includes(id));
const isFile = (path) => Object.hasOwn(mock.files, path.replace(/^\.\//, '').replace(mock.workspace.path + '/', ''));

Object.assign(mock.commands, {
  term_reset: () => {
    term.calls.push('reset');
    term.closed.push(...live());
  },
  term_start: ({ id }) => {
    term.calls.push('start');
    if (mock.options.termStartError) throw mock.options.termStartError;
    if (live().length >= 4) throw 'At most 4 terminals can be open at once';
    const first = term.started.length === 0;
    term.started.push(id);
    term.input[id] = [];
    const intro = first ? (mock.options.termOutput ?? `uv run python -c "from stats.running import RunningStats"\r\n`) : '';
    setTimeout(() => write(id, `\x1b[?2004h${prompt}${intro}${intro ? prompt : ''}`), 50);
  },
  term_input: ({ id, data }) => {
    term.calls.push(`input ${id}`);
    term.input[id]?.push(data);
  },
  term_resize: ({ id, cols, rows }) => term.resized.push({ id, cols, rows }),
  term_ack: ({ id, bytes }) => (term.acked[id] = (term.acked[id] || 0) + bytes),
  term_close: ({ id }) => term.closed.push(id),
  term_busy: () =>
    live()
      .map((id) => ({ id, command: (mock.options.termBusy || [])[term.started.indexOf(id)] }))
      .filter((b) => b.command != null),
  term_run_command: ({ path }) => {
    if (/[\x00-\x1f\x7f]/.test(path))
      throw 'Its name contains a control character, which the terminal would take as a keystroke. Rename the file and try again.';
    const uv = isFile('pyproject.toml') || isFile('uv.lock');
    const quoted = /^[\w@%+:,./-][\w@%+=:,./-]*$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;
    return `${uv ? 'uv run python' : 'python3'} ${quoted}`;
  },
  term_resolve: ({ paths }) => paths.map((p) => (isFile(p) ? p.replace(/^\.\//, '').replace(mock.workspace.path + '/', '') : null)),
});
