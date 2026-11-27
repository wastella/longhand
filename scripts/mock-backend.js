// A stand-in for the Rust backend, so the interface can be opened in an ordinary browser.
// Used by `npm run screenshot` and handy for interface work that does not need a real folder.
(() => {
  const files = {
    'README.md': '# Running statistics\n\nImplement the functions in `stats/running.py` so the tests pass.\n',
    'pyproject.toml': '[project]\nname = "running-stats"\nversion = "0.1.0"\ndependencies = ["pytest"]\n',
    'stats/__init__.py': '',
    'stats/running.py': [
      '"""Statistics over a stream of numbers, without storing the stream."""',
      '',
      '',
      'class RunningStats:',
      '    def __init__(self) -> None:',
      '        self.count = 0',
      '        self.mean = 0.0',
      '        self.sum_sq = 0.0',
      '',
      '    def push(self, x: float) -> None:',
      '        self.count += 1',
      '        delta = x - self.mean',
      '        self.mean += delta / self.count',
      '        self.sum_sq += delta * delta',
      '',
      '    def variance(self) -> float:',
      '        if self.count < 2:',
      '            return 0.0',
      '        return self.sum_sq / (self.count - 1)',
      '',
    ].join('\n'),
    'tests/test_running.py':
      'from stats.running import RunningStats\n\n\ndef test_mean():\n    s = RunningStats()\n    for x in [2.0, 4.0, 6.0]:\n        s.push(x)\n    assert s.mean == 4.0\n\n\ndef test_variance():\n    s = RunningStats()\n    for x in [2.0, 4.0, 6.0]:\n        s.push(x)\n    assert s.variance() == 4.0\n',
  };
  const detail = [
    '________________________________ test_variance _________________________________',
    'tests/test_running.py:15: in test_variance',
    '    assert s.variance() == 4.0',
    'E   assert 6.0 == 4.0',
    'E    +  where 6.0 = variance()',
  ].join('\n');
  const answer = [
    'Your `variance` divides by the right thing, so look at what `push` accumulates.',
    '',
    'Try it by hand on the stream 2, 4, 6. After each `push`, write down `mean` and `sum_sq`, and compare `sum_sq` with the sum of squared distances from the *final* mean, which is 8.',
    '',
    'One question to check your reading of lines 12–14: when you compute `delta`, which mean is it measured from, and has that mean moved by the time you square it?',
  ].join('\n');

  const listeners = {};
  const emit = (name, payload) => (listeners[name] || []).forEach((fn) => fn({ payload }));
  const options = (window.__MOCK__ = window.__MOCK__ || {});
  window.__emit = emit;
  window.__files = files;
  window.__asked = [];
  let gen = 0;

  const list = (rel) => {
    const prefix = rel ? rel + '/' : '';
    const seen = new Map();
    for (const path of Object.keys(files)) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length).split('/');
      seen.set(rest[0], rest.length > 1);
    }
    return [...seen].map(([name, dir]) => ({ name, dir, path: prefix + name })).sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name));
  };

  const commands = {
    app_init: () => ({
      lastWorkspace: null,
      openDir: '/demo/running-stats',
      auth: options.auth || { installed: true, loggedIn: true, plan: 'max' },
      smoke: false,
    }),
    auth_status: () => window.__MOCK__.auth || { installed: true, loggedIn: true, plan: 'max' },
    workspace_open: () =>
      setTimeout(() =>
        emit('workspace:opened', {
          path: '/demo/running-stats',
          name: 'running-stats',
          config: { policy: 'strict', model: 'sonnet' },
          courseRules: 'AGENTS.md',
          log: { today: { ask: 3, reveal: 0, tests: 5 }, total: { ask: 3, reveal: 0, tests: 5 } },
        }),
      ),
    fs_list: ({ rel }) => list(rel),
    fs_read: ({ rel }) => ({ text: files[rel], mtime: 1 }),
    fs_write: ({ rel, text }) => ((files[rel] = text), { mtime: 1 }),
    fs_mtime: () => 1,
    fs_create: ({ rel, dir }) => void (files[dir ? rel + '/.keep' : rel] = ''),
    fs_rename: ({ from, to }) => {
      for (const path of Object.keys(files)) {
        if (path !== from && !path.startsWith(from + '/')) continue;
        files[to + path.slice(from.length)] = files[path];
        delete files[path];
      }
    },
    fs_trash: ({ rel }) => {
      for (const path of Object.keys(files)) if (path === rel || path.startsWith(rel + '/')) delete files[path];
    },
    fs_search: ({ query }) => {
      const hits = [];
      for (const [path, text] of Object.entries(files))
        text.split('\n').forEach((line, i) => line.toLowerCase().includes(query.toLowerCase()) && hits.push({ path, line: i + 1, text: line.trim() }));
      return { hits, truncated: false };
    },
    term_start: () => (
      setTimeout(
        () =>
          emit('term:data', {
            id: 1,
            data: '\x1b[2mrunning-stats\x1b[0m % uv run python -c "from stats.running import RunningStats"\r\n\x1b[2mrunning-stats\x1b[0m % ',
          }),
        50,
      ),
      1
    ),
    tests_run: () => {
      setTimeout(
        () =>
          emit('tests:done', {
            command: 'uv run pytest -rA --tb=short -q --color=no',
            code: 1,
            cancelled: false,
            output: detail,
            summary: '1 failed, 1 passed in 0.03s',
            tests: [
              { status: 'PASSED', id: 'tests/test_running.py::test_mean', message: '', detail: '' },
              { status: 'FAILED', id: 'tests/test_running.py::test_variance', message: 'assert 6.0 == 4.0', detail },
            ],
          }),
        100,
      );
      return 'uv run pytest -rA --tb=short -q --color=no';
    },
    tutor_ask: ({ prompt, kind }) => {
      const g = ++gen;
      window.__asked.push({ prompt, kind });
      let reply = answer;
      if (prompt.includes('include code'))
        reply =
          'Run this:\n\n```bash\nuv run pytest\n```\n\nAn analogous example:\n\n```python\ndef push(self, x):\n    self.total += x\n    self.count += 1\n```';
      if (prompt.includes('be hostile'))
        reply =
          'Hi <script>window.__pwned = 1</script><img src=x onerror="window.__pwned = 1"> [link](https://example.com) [bad](javascript:window.__pwned=1) <iframe src="https://example.com"></iframe>';
      setTimeout(() => emit('tutor:event', { gen: g, type: 'tool', name: 'Read', target: '/demo/running-stats/stats/running.py' }), 20);
      setTimeout(() => emit('tutor:event', { gen: g, type: 'text', text: reply }), 60);
      setTimeout(() => emit('tutor:event', { gen: g, type: 'done' }), 100);
      return g;
    },
    log_summary: () => ({ today: { ask: 4, reveal: 0, tests: 5 }, total: { ask: 4, reveal: 0, tests: 5 } }),
    log_record: () => ({ today: { ask: 4, reveal: 1, tests: 5 }, total: { ask: 4, reveal: 1, tests: 5 } }),
    config_set: ({ patch }) => ({ policy: 'strict', model: 'sonnet', ...patch }),
    confirm: () => true,
  };

  window.__TAURI__ = {
    core: { invoke: async (cmd, args) => (commands[cmd] ? commands[cmd](args || {}) : null) },
    event: { listen: async (name, fn) => ((listeners[name] = listeners[name] || []).push(fn), () => {}) },
    window: { getCurrentWindow: () => ({ onCloseRequested: async () => () => {} }) },
  };
})();
