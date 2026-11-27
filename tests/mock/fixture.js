// The folder every mock session opens: a small pytest project with one failing test.
// window.__files exposes it so tests can check what was written.

const mock = window.__mock;

mock.files = window.__files = {
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

mock.workspace = {
  path: '/demo/running-stats',
  name: 'running-stats',
  config: { policy: 'strict', model: 'sonnet' },
  courseRules: 'AGENTS.md',
  log: { today: { ask: 3, reveal: 0, tests: 5 }, total: { ask: 3, reveal: 0, tests: 5 } },
};
