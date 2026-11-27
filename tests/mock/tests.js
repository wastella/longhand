// A pytest run over the fixture: test_mean passes, test_variance fails.

const mock = window.__mock;
const command = 'uv run pytest -rA --tb=short -q --color=no';
const traceback = [
  '________________________________ test_variance _________________________________',
  'tests/test_running.py:15: in test_variance',
  '    assert s.variance() == 4.0',
  'E   assert 6.0 == 4.0',
  'E    +  where 6.0 = variance()',
].join('\n');

Object.assign(mock.commands, {
  tests_run: () => {
    setTimeout(
      () =>
        mock.emit('tests:done', {
          command,
          code: 1,
          cancelled: false,
          output: traceback,
          summary: '1 failed, 1 passed in 0.03s',
          tests: [
            { status: 'PASSED', id: 'tests/test_running.py::test_mean', message: '', detail: '' },
            { status: 'FAILED', id: 'tests/test_running.py::test_variance', message: 'assert 6.0 == 4.0', detail: traceback },
          ],
        }),
      100,
    );
    return command;
  },
});
