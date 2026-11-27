// pytest runs, shaped like src-tauri/src/pytest.rs: tests_run returns { run, command } (or
// { run, problem }), then tests:output and tests:progress arrive while it runs and tests:done
// ends it, each carrying the run's id. A cancelled run says nothing more.
//
// Options (window.__MOCK__, read at the start of each run so a test can change them between runs):
//   testsSuite      'fixture' (default: test_mean passes, test_variance fails) or 'course' (a
//                   larger suite in the style of a course assignment)
//   testsProblem    'no-uv', 'no-pytest', 'no-tests', 'not-python' or 'collect-error'
//   testsHangAfter  stop after this many results and keep running until cancelled
//   testsCrashAfter end the run after this many results as if the process crashed while
//                   running the next test (which gets an error result)
//   testsNoTotal    never say how many tests there are, as with pytest-xdist
//   testsDelay      milliseconds between results (default 15)
//   testOutcomes    { [id]: 'PASSED' | 'FAILED' | … } overrides a test's status
//   testsGone       ids that no longer exist: a run leaves them out of what it collected

const mock = window.__mock;
const options = mock.options;

const frame = (path, line, func, lines, own = true) => ({ path, line, rel: own ? path : undefined, own, func, lines });
const result = (id, status, extra = {}) => ({
  id,
  status,
  duration: 0.002,
  path: id.split('::')[0],
  line: 1,
  message: '',
  detail: '',
  frames: [],
  sections: [],
  ...extra,
});
const failure = (frames, extra = {}) => {
  const last = frames.at(-1);
  const message = last.lines
    .filter((l) => l.startsWith('E'))
    .map((l) => l.replace(/^E {0,3}/, ''))
    .join('\n');
  const detail = frames.map((f) => f.note || `${f.path}:${f.line}: in ${f.func}\n${f.lines.join('\n')}`).join('\n');
  return { frames, message, detail, at: [...frames].reverse().find((f) => f.own), ...extra };
};

const variance = failure([
  frame('tests/test_running.py', 15, 'test_variance', ['    assert s.variance() == 4.0', 'E   assert 6.0 == 4.0', 'E    +  where 6.0 = variance()']),
]);

const suites = {
  fixture: () => [
    result('tests/test_running.py::test_mean', 'PASSED', { line: 4 }),
    result('tests/test_running.py::test_variance', 'FAILED', { line: 11, duration: 0.003, ...variance }),
  ],
  course: () => {
    const todo = (file, test, line, fn, fnLine) =>
      failure([
        frame(file, line, test, [`    output = ${fn}(d_in, d_out, weights, in_features)`]),
        frame('tests/adapters.py', fnLine, fn, ['    raise NotImplementedError', 'E   NotImplementedError']),
      ]);
    const numpy = (name) => `.venv/lib/python3.12/site-packages/numpy/testing/_private/${name}`;
    return [
      result('tests/test_model.py::test_linear', 'FAILED', {
        line: 18,
        ...todo('tests/test_model.py', 'test_linear', 22, 'run_linear', 31),
        sections: [{ title: 'Captured stdout call', text: Array.from({ length: 150 }, (_, i) => `step ${i}: loss 2.${i}`).join('\n') + '\n' }],
      }),
      result('tests/test_model.py::test_embedding', 'FAILED', {
        line: 27,
        duration: 0.41,
        ...failure([
          frame('tests/test_model.py', 34, 'test_embedding', ['    numpy.testing.assert_allclose(actual.detach().numpy(), expected, atol=1e-6)']),
          frame(numpy('utils.py'), 1504, 'assert_allclose', ['    assert_array_compare(compare, actual, desired, err_msg=str(err_msg),'], false),
          frame(numpy('utils.py'), 797, 'assert_array_compare', ['    raise AssertionError(msg)'], false),
          frame(
            '/usr/lib/python3.12/contextlib.py',
            81,
            'inner',
            [
              '    return func(*args, **kwds)',
              'E   AssertionError: ',
              'E   Not equal to tolerance rtol=1e-07, atol=1e-06',
              'E   ',
              'E   Mismatched elements: 3 / 12 (25%)',
              'E   Max absolute difference among violations: 0.01231',
              'E   Max relative difference among violations: 0.0417',
              'E    ACTUAL: array([[ 0.2931, -0.5123,  1.0042],',
              'E    DESIRED: array([[ 0.2931, -0.5246,  1.0042],',
            ],
            false,
          ),
        ]),
        sections: [{ title: 'Captured stdout call', text: 'embedding table: torch.Size([10000, 64])\nindices: torch.Size([4, 3])\n' }],
      }),
      result('tests/test_model.py::test_scaled_dot_product_attention[mask0]', 'PASSED', { line: 41, duration: 0.03 }),
      result('tests/test_model.py::test_scaled_dot_product_attention[mask1]', 'FAILED', {
        line: 41,
        ...failure([
          frame('tests/test_model.py', 52, 'test_scaled_dot_product_attention', [
            '    assert torch.allclose(actual, expected)',
            'E   assert False',
            'E    +  where False = allclose(tensor([[0.1, 0.9]]), tensor([[0.5, 0.5]]))',
          ]),
        ]),
      }),
      result('tests/test_model.py::TestTransformerBlock::test_forward', 'ERROR', {
        line: 60,
        phase: 'setup',
        ...failure([
          frame('tests/conftest.py', 14, 'ts_state_dict', ['    return torch.load(FIXTURES / "ts_tests" / "model.pt")']),
          frame(
            '.venv/lib/python3.12/site-packages/torch/serialization.py',
            1425,
            'load',
            [
              '    with _open_file_like(f, "rb") as opened_file:',
              "E   FileNotFoundError: [Errno 2] No such file or directory: 'tests/fixtures/ts_tests/model.pt'",
            ],
            false,
          ),
        ]),
      }),
      result('tests/test_model.py::test_rmsnorm', 'PASSED', { line: 70, duration: 0.04 }),
      result('tests/test_model.py::test_rope', 'PASSED', { line: 78, duration: 0.02 }),
      result('tests/test_nn_utils.py::test_softmax_matches_pytorch', 'PASSED', { line: 9 }),
      result('tests/test_nn_utils.py::test_cross_entropy', 'PASSED', { line: 21 }),
      result('tests/test_nn_utils.py::test_gradient_clipping', 'PASSED', { line: 36, duration: 0.12 }),
      result('tests/test_tokenizer.py::test_roundtrip_empty', 'PASSED', { line: 40 }),
      result('tests/test_tokenizer.py::test_roundtrip_unicode_string', 'PASSED', { line: 52 }),
      result('tests/test_tokenizer.py::test_encode_iterable_memory_usage', 'SKIPPED', { line: 88, message: 'rlimit support for non-linux systems is spotty.' }),
      result('tests/test_tokenizer.py::test_tinystories_matches_tiktoken', 'PASSED', { line: 120, duration: 3.42 }),
      result('tests/test_tokenizer.py::test_train_bpe_speed', 'XFAIL', { line: 140, duration: 1.8, message: 'needs the merge cache' }),
    ];
  },
};

const collectError = () =>
  result('tests/test_running.py', 'ERROR', {
    phase: 'collect',
    ...failure([
      {
        note: "ImportError while importing test module '/demo/running-stats/tests/test_running.py'.\nHint: make sure your test modules/packages have valid Python names.\nTraceback:",
        own: false,
      },
      frame('/usr/lib/python3.12/importlib/__init__.py', 90, 'import_module', ['    return _bootstrap._gcd_import(name[level:], package, level)'], false),
      frame('tests/test_running.py', 1, '<module>', ['    from stats.running import RunningStats', "E   ModuleNotFoundError: No module named 'stats.runing'"]),
    ]),
  });

const problems = {
  'no-uv': {
    output: 'zsh:1: command not found: uv\n',
    problem: {
      kind: 'no-uv',
      title: 'uv is not installed',
      detail:
        'This folder has a pyproject.toml, so its tests run with uv, which this Mac does not have (or which is not on the PATH of a login shell). Install it, then run the tests again.',
      fix: 'curl -LsSf https://astral.sh/uv/install.sh | sh',
    },
  },
  'no-pytest': {
    output: 'error: Failed to spawn: `pytest`\n  Caused by: No such file or directory (os error 2)\n',
    problem: {
      kind: 'no-pytest',
      title: 'pytest is not installed in this project',
      detail: "uv set up the project's environment, but pytest is not one of its dependencies. Add it, then run the tests again.",
      fix: 'uv add --dev pytest',
    },
  },
  'no-tests': {
    output: 'collected 0 items\n\nno tests ran in 0.01s\n',
    problem: {
      kind: 'no-tests',
      title: 'No tests found',
      detail: 'pytest looks for files named test_*.py or *_test.py, and for functions in them whose names start with test.',
    },
  },
};

const matches = (id, targets) =>
  !targets.length || targets.some((t) => id === t || id.startsWith(`${t}::`) || id.startsWith(`${t}[`) || id.split('::')[0] === t);

let current = null;

function finish(run, extra = {}) {
  clearTimeout(run.timer);
  current = null;
  const failedCount = run.tests.filter((t) => t.status === 'FAILED').length;
  const passed = run.tests.filter((t) => t.status === 'PASSED').length;
  const summary = [failedCount && `${failedCount} failed`, passed && `${passed} passed`].filter(Boolean).join(', ') || 'no tests ran';
  mock.emit('tests:done', {
    run: run.id,
    command: run.command,
    targets: run.targets,
    code: failedCount || run.errors.length ? 1 : 0,
    cancelled: false,
    complete: true,
    problem: null,
    summary: `${summary} in 0.03s`,
    total: run.total,
    collected: run.collected,
    duration: 0.03,
    tests: run.tests,
    errors: run.errors,
    output: run.output,
    ...extra,
  });
}

function start(id, targets) {
  const problem = problems[options.testsProblem];
  const run = {
    id,
    command: `uv run pytest -p longhand_pytest --rootdir=. --tb=short --color=no${targets.map((t) => ` '${t}'`).join('')}`,
    targets,
    tests: [],
    errors: [],
    output: '',
  };
  current = run;
  const progress = (updates) => mock.emit('tests:progress', { run: id, updates });
  const say = (text) => ((run.output += text), mock.emit('tests:output', { run: id, text }));
  say(`============================= test session starts ==============================\n`);
  if (problem) {
    run.output = problem.output;
    run.timer = setTimeout(
      () =>
        finish(run, {
          problem: problem.problem,
          code: 2,
          summary: 'no tests ran in 0.00s',
          complete: problem.problem.kind === 'no-tests',
          collected: problem.problem.kind === 'no-tests' ? [] : null,
        }),
      30,
    );
    return;
  }
  if (options.testsProblem === 'collect-error') {
    run.errors = [collectError()];
    run.total = 0;
    run.collected = [];
    progress([{ type: 'started' }, { type: 'collect-error', test: run.errors[0] }, { type: 'collected', total: 0 }]);
    run.timer = setTimeout(() => finish(run, { code: 2, summary: '1 error in 0.08s' }), 30);
    return;
  }
  const overrides = options.testOutcomes || {};
  const gone = new Set(options.testsGone || []);
  const all = suites[options.testsSuite || 'fixture']().filter((t) => matches(t.id, targets) && !gone.has(t.id));
  const queue = all.map((t) =>
    overrides[t.id] ? { ...t, status: overrides[t.id], ...(overrides[t.id] === 'PASSED' && { message: '', frames: [], detail: '', at: undefined }) } : t,
  );
  run.total = options.testsNoTotal ? null : queue.length;
  run.collected = queue.map((t) => t.id);
  progress([{ type: 'started' }, ...(options.testsNoTotal ? [] : [{ type: 'collected', total: queue.length }])]);
  say(`collected ${queue.length} items\n\n`);
  const step = () => {
    if (current !== run) return;
    const next = queue.shift();
    if (!next) return finish(run);
    progress([{ type: 'running', id: next.id }]);
    if (options.testsHangAfter != null && run.tests.length >= options.testsHangAfter) return;
    if (options.testsCrashAfter != null && run.tests.length >= options.testsCrashAfter) {
      const message = 'The test process ended while this test was running (signal 11 (SIGSEGV, a crash in native code)), so it has no result.';
      run.tests.push({ ...next, status: 'ERROR', phase: 'ended', message, detail: '', frames: [], at: undefined, sections: [] });
      const detail =
        'The Python process running the tests ended before pytest finished (signal 11 (SIGSEGV, a crash in native code)). A test that was running when it stopped is shown as an error.';
      return finish(run, {
        complete: false,
        code: 139,
        signal: 11,
        problem: { kind: 'stopped-early', title: 'pytest stopped before the run finished', detail },
      });
    }
    run.tests.push(next);
    say(`${next.id} ${next.status}\n`);
    progress([{ type: 'result', test: next }]);
    run.timer = setTimeout(step, options.testsDelay ?? 15);
  };
  run.timer = setTimeout(step, options.testsDelay ?? 15);
}

Object.assign(mock.commands, {
  tests_run: ({ targets, run }) => {
    window.__testRuns = [...(window.__testRuns || []), targets || []];
    window.__testRunToken = () => run;
    // Like the backend, a run that a new one replaces ends without a word.
    if (current) clearTimeout(current.timer);
    current = null;
    if (options.testsProblem === 'not-python') {
      return {
        run,
        problem: {
          kind: 'not-python',
          title: 'This folder has no Python code',
          detail:
            'The test panel runs Python tests with pytest, and there are no .py files here. Open the folder that holds your assignment (usually the one with pyproject.toml).',
        },
      };
    }
    start(run, targets || []);
    return { run, command: current.command };
  },
  // Like the backend, a cancelled run says nothing more; the interface ends it.
  tests_cancel: () => {
    if (current) clearTimeout(current.timer);
    current = null;
  },
});
