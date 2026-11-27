import assert from 'node:assert/strict';
import { count, isHidden, openFromTree, sleep, text, uiTest } from './helpers.mjs';
import { hoverTerminalText, options as tracebackOutput } from '../../scripts/scenarios/terminal-traceback.mjs';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Waits for the first terminal's prompt, then focuses the terminal in front. */
async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#terminal .xterm-rows')?.textContent.includes('running-stats %'));
  await page.focus('#terminal .term-view:not([hidden]) textarea');
}

const sent = (page, index = 0) => page.evaluate((i) => window.__term.input[window.__term.started[i]].join(''), index);
const screen = (page) => page.$eval('#terminal .term-view:not([hidden]) .xterm-rows', (n) => n.textContent);

async function press(page, key, modifier = 'Meta') {
  await page.keyboard.down(modifier);
  await page.keyboard.press(key);
  await page.keyboard.up(modifier);
}

uiTest('the terminal starts a shell in the open folder and shows its output', async (page) => {
  await ready(page);
  assert.equal(await page.$eval('.tab-btn.active', (n) => n.dataset.pane), 'terminal');
  // Output is acknowledged once drawn, so the backend keeps sending.
  await page.waitForFunction(() => Object.values(window.__term.acked)[0] > 0);
  // Started at the size of the pane, not a default 80 by 24.
  const size = await page.evaluate(() => window.__term.started.length && document.querySelector('#terminal .xterm-screen').offsetWidth);
  assert.ok(size > 600);
});

uiTest('typing reaches the shell; Cmd+C without a selection sends nothing and Ctrl+C interrupts', async (page) => {
  await ready(page);
  await page.keyboard.type('ls');
  await press(page, 'c', 'Meta');
  await press(page, 'c', 'Control');
  await page.waitForFunction(() => Object.values(window.__term.input)[0].join('').includes('\x03'));
  assert.equal(await sent(page), 'ls\x03');
});

uiTest('Cmd+A selects the whole buffer for copying, and Cmd+K clears it', async (page) => {
  await ready(page);
  await press(page, 'a');
  const copied = await page.evaluate(() => {
    const event = new ClipboardEvent('copy', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true });
    document.querySelector('#terminal .term-view:not([hidden]) textarea').dispatchEvent(event);
    return event.clipboardData.getData('text/plain');
  });
  assert.match(copied, /from stats\.running import RunningStats/);
  await press(page, 'k');
  await page.waitForFunction(() => !document.querySelector('#terminal .xterm-rows').textContent.includes('RunningStats'));
  assert.equal(await sent(page), '', 'neither shortcut reached the shell');
});

uiTest('pasting wraps the text in bracketed-paste markers when the shell asks for them', async (page) => {
  await ready(page);
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'print(1)\nprint(2)');
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    document.querySelector('#terminal .term-view:not([hidden]) textarea').dispatchEvent(event);
  });
  await page.waitForFunction(() => Object.values(window.__term.input)[0].length > 0);
  assert.equal(await sent(page), '\x1b[200~print(1)\rprint(2)\x1b[201~');
});

uiTest('the terminal resizes with the text size and after being hidden', async (page) => {
  await ready(page);
  await page.evaluate(() => window.__emit('menu', 'zoom-in'));
  await page.evaluate(() => window.__emit('menu', 'zoom-in'));
  await page.waitForFunction(() => window.__term.resized.length > 0);
  const bigger = await page.evaluate(() => window.__term.resized.at(-1));
  await page.evaluate(() => window.__emit('menu', 'toggle-bottom'));
  await page.evaluate(() => window.__emit('menu', 'zoom-out'));
  await page.evaluate(() => window.__emit('menu', 'zoom-out'));
  await page.evaluate(() => window.__emit('menu', 'zoom-out'));
  await sleep(100);
  assert.equal(await page.evaluate(() => window.__term.resized.length), 1, 'nothing to measure while hidden');
  await page.evaluate(() => window.__emit('menu', 'toggle-bottom'));
  await page.waitForFunction(() => window.__term.resized.length > 1);
  const smaller = await page.evaluate(() => window.__term.resized.at(-1));
  assert.ok(smaller.cols > bigger.cols && smaller.rows > bigger.rows);
});

uiTest('wide characters and emoji take two columns', async (page) => {
  await ready(page);
  await page.evaluate(() => window.__termWrite('\r\n🙂|\r\n世|\r\nab|\r\n'));
  await page.waitForFunction(() => document.querySelector('#terminal .xterm-rows').textContent.includes('ab|'));
  const bars = await page.evaluate(() =>
    [...document.querySelectorAll('#terminal .xterm-rows > div')]
      .filter((row) => /^(🙂|世|ab)\|/.test(row.textContent))
      .map((row) => {
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const at = walker.currentNode.data.indexOf('|');
          if (at < 0) continue;
          const range = document.createRange();
          range.setStart(walker.currentNode, at);
          range.setEnd(walker.currentNode, at + 1);
          return Math.round(range.getBoundingClientRect().left);
        }
      }),
  );
  assert.equal(bars.length, 3);
  assert.ok(Math.abs(bars[0] - bars[2]) <= 1 && Math.abs(bars[1] - bars[2]) <= 1, `bars at ${bars}`);
});

uiTest('up to four terminals, each keeping its output while another is in front', async (page) => {
  await ready(page);
  assert.equal(await isHidden(page, '#terminal-tabs'), true, 'no tabs for a single terminal');
  await page.click('#terminal-add');
  await page.waitForFunction(() => window.__term.started.length === 2);
  assert.equal(await count(page, '#terminal-tabs .term-tab'), 2);
  assert.doesNotMatch(await screen(page), /RunningStats/);
  await page.click('#terminal-add');
  await page.evaluate(() => window.__emit('menu', 'new-terminal'));
  await page.waitForFunction(() => window.__term.started.length === 4);
  assert.equal(await page.$eval('#terminal-add', (n) => n.disabled), true);
  await page.click('#terminal-tabs .term-tab:first-child .term-tab-name');
  assert.match(await screen(page), /RunningStats/);
  // Closing one stops its shell and labels stay put; a new one takes the free label.
  await page.click('#terminal-tabs .term-tab:nth-child(2) .term-tab-close');
  await page.waitForFunction(() => window.__term.closed.length === 1);
  assert.deepEqual(await page.$$eval('#terminal-tabs .term-tab-name', (n) => n.map((x) => x.textContent)), ['1', '3', '4']);
  await page.click('#terminal-add');
  assert.deepEqual(await page.$$eval('#terminal-tabs .term-tab-name', (n) => n.map((x) => x.textContent)), ['1', '2', '3', '4']);
});

uiTest(
  'closing or restarting a terminal with a running command asks first',
  async (page) => {
    await ready(page);
    await page.click('#terminal-add');
    await page.waitForFunction(() => window.__term.started.length === 2);
    await page.click('#terminal-tabs .term-tab:first-child .term-tab-close');
    await page.waitForFunction(() => window.__confirmed);
    assert.equal(await page.evaluate(() => window.__confirmed), '“uv run python train.py” is still running in terminal 1. Close the terminal and stop it?');
    assert.equal(await count(page, '#terminal-tabs .term-tab'), 2, 'backing out keeps it');
    await page.click('#terminal-tabs .term-tab:first-child .term-tab-name');
    await page.evaluate(() => (window.__confirmed = null));
    await page.click('#terminal-restart');
    await page.waitForFunction(() => window.__confirmed);
    assert.equal(await page.evaluate(() => window.__term.started.length), 2, 'not restarted');
  },
  { termBusy: ['uv run python train.py'], confirm: false },
);

uiTest('when the shell exits the terminal says so, and a key or Restart starts a new one', async (page) => {
  await ready(page);
  await page.evaluate(() => window.__emit('term:exit', { id: window.__term.started[0], code: 0 }));
  await page.waitForFunction(() => document.querySelector('#terminal .xterm-rows').textContent.includes('The shell exited'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__term.started.length === 2);
  assert.equal(await sent(page, 0), '', 'the key only restarts');
  await page.waitForFunction(() => document.querySelector('#terminal .xterm-rows').textContent.includes('running-stats %'));
  await page.click('#terminal-restart');
  await page.waitForFunction(() => window.__term.started.length === 3);
  assert.deepEqual(await page.evaluate(() => window.__term.closed), [await page.evaluate(() => window.__term.started[1])]);
});

uiTest(
  'quitting while a command runs names it and can be called off',
  async (page) => {
    await ready(page);
    assert.equal(await page.evaluate(() => window.__requestClose()), false);
    assert.equal(await page.evaluate(() => window.__confirmed), '“uv run python train.py” is still running in the terminal. Quit and stop it?');
    await page.evaluate(() => (window.__MOCK__.termBusy = []));
    assert.equal(await page.evaluate(() => window.__requestClose()), true, 'nothing running: closes without asking');
  },
  { termBusy: ['uv run python train.py'], confirm: false },
);

uiTest('opening another folder leaves one fresh terminal', async (page) => {
  await ready(page);
  await page.click('#terminal-add');
  await page.waitForFunction(() => window.__term.started.length === 2);
  await page.evaluate(() => window.__emit('workspace:opened', window.__mock.workspace));
  await page.waitForFunction(() => window.__term.started.length === 3);
  assert.equal(await count(page, '#terminal .term-view'), 1);
  assert.equal(await isHidden(page, '#terminal-tabs'), true);
});

uiTest('Run File saves the Python file and runs it with uv', async (page) => {
  await ready(page);
  await page.evaluate(() => window.__emit('menu', 'run-file'));
  assert.equal(await text(page, '#status-msg'), 'Open a Python file to run it.');
  await openFromTree(page, 'stats/running.py');
  await page.click('.cm-content');
  await page.keyboard.type('# note\n');
  await page.click('.tab-btn[data-pane="tests"]');
  await page.evaluate(() => window.__emit('menu', 'run-file'));
  await page.waitForFunction(() => Object.values(window.__term.input)[0].length > 0);
  assert.equal(await sent(page), '\x05\x15uv run python stats/running.py\r');
  assert.match(await page.evaluate(() => window.__files['stats/running.py']), /# note/);
  assert.equal(await page.$eval('.tab-btn.active', (n) => n.dataset.pane), 'terminal');
});

uiTest(
  'Run File uses a new terminal when the one in front is busy, without uv outside a uv project',
  async (page) => {
    await page.evaluate(() => delete window.__files['pyproject.toml']);
    await ready(page);
    await openFromTree(page, 'stats/running.py');
    await page.evaluate(() => window.__emit('menu', 'run-file'));
    await page.waitForFunction(() => window.__term.started.length === 2 && window.__term.input[window.__term.started[1]].length);
    assert.equal(await sent(page, 1), '\x05\x15python3 stats/running.py\r');
    assert.equal(await sent(page, 0), '');
    // The command is typed only once the new shell has printed its prompt.
    const calls = await page.evaluate(() => window.__term.calls);
    const id = await page.evaluate(() => window.__term.started[1]);
    assert.ok(calls.indexOf(`output ${id}`) >= 0 && calls.indexOf(`output ${id}`) < calls.indexOf(`input ${id}`), calls.join(', '));
  },
  { termBusy: ['uv run python train.py'] },
);

uiTest(
  'Run File says so when the terminal cannot start, rather than that every terminal is busy',
  async (page) => {
    await openFromTree(page, 'stats/running.py');
    await page.waitForFunction(() => document.querySelector('#terminal .xterm-rows').textContent.includes('could not start'));
    await page.evaluate(() => window.__emit('menu', 'run-file'));
    await page.waitForFunction(() => document.querySelector('#status-msg').textContent);
    assert.equal(await text(page, '#status-msg'), 'The terminal could not start. Press Restart to try again.');
  },
  { termStartError: 'Could not start the shell: no such file' },
);

uiTest(
  'Run File refuses a file name with control characters, which the shell would take as keys',
  async (page) => {
    await ready(page);
    await page.evaluate(() => [...document.querySelectorAll('#tree .node')].find((n) => n.dataset.path.includes('\x03')).click());
    await page.waitForSelector('.cm-content');
    await page.evaluate(() => window.__emit('menu', 'run-file'));
    await page.waitForFunction(() => document.querySelector('#status-msg').textContent);
    assert.match(await text(page, '#status-msg'), /control character.*Rename the file/);
    assert.equal(await sent(page), '');
  },
  { files: { 'a\x03touch PWNED\r.py': 'print(1)\n' } },
);

uiTest('shells left by an earlier load of the page are stopped before the first starts', async (page) => {
  await ready(page);
  const calls = await page.evaluate(() => window.__term.calls.filter((c) => c === 'reset' || c === 'start'));
  assert.deepEqual(calls, ['reset', 'start']);
});

uiTest('only web links from OSC 8 hyperlinks are offered', async (page) => {
  await ready(page);
  await page.evaluate(() =>
    window.__termWrite('\x1b]8;;file:///etc/passwd\x07local-file\x1b]8;;\x07 and \x1b]8;;https://example.com/\x07the-site\x1b]8;;\x07\r\n'),
  );
  await hoverTerminalText(page, 'local-file', { hint: false });
  await sleep(200);
  assert.equal(await count(page, '.term-link-hint:not([hidden])'), 0);
  await hoverTerminalText(page, 'the-site');
  assert.equal(await text(page, '.term-link-hint:not([hidden])'), 'Open https://example.com/ in the browser');
});

uiTest(
  'file locations in output open in the editor, and web links in the browser',
  async (page) => {
    await page.evaluate(() => (window.__mock.commands.open_external = ({ url }) => (window.__opened = url)));
    await ready(page);
    const python = await hoverTerminalText(page, 'running.py", line 19');
    assert.equal(await text(page, '.term-link-hint:not([hidden])'), 'Open stats/running.py, line 19');
    // The underline covers the path only, not the quotes around it.
    const underlined = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#terminal .xterm-rows > div')].find((r) => r.textContent.includes('line 19'));
      return [...row.querySelectorAll('span')]
        .filter((n) => n.style.textDecoration === 'underline')
        .map((n) => n.textContent)
        .join('');
    });
    assert.equal(underlined, '/demo/running-stats/stats/running.py');
    await page.mouse.click(python.x, python.y);
    await page.waitForFunction(() => document.querySelector('#status-pos').textContent.startsWith('Ln 19'));
    assert.equal(await text(page, '#status-file'), 'stats/running.py');

    const pytest = await hoverTerminalText(page, 'test_running.py:15');
    await page.mouse.click(pytest.x, pytest.y);
    await page.waitForFunction(() => document.querySelector('#status-file').textContent === 'tests/test_running.py');
    assert.match(await text(page, '#status-pos'), /^Ln 15,/);

    const url = await hoverTerminalText(page, 'docs.python.org');
    await page.mouse.click(url.x, url.y);
    await page.waitForFunction(() => window.__opened);
    assert.equal(await page.evaluate(() => window.__opened), 'https://docs.python.org/3/library/exceptions.html');
  },
  tracebackOutput,
);

uiTest('finding links in a very long line stays fast', async (page) => {
  const slowest = await page.evaluate(async () => {
    const { findLocations } = await import(new URL('../src/renderer/terminal/locations.js', location.href));
    const lines = ['https://x/' + ')'.repeat(30000), 'File "'.repeat(10000), 'a.py:1 '.repeat(10000), '/a'.repeat(20000) + '.p', 'a.b'.repeat(20000)];
    return Math.max(
      ...lines.map((line) => {
        const start = performance.now();
        findLocations(line);
        return performance.now() - start;
      }),
    );
  });
  assert.ok(slowest < 50, `took ${slowest} ms`);
  // And hovering a long wrapped line in the terminal finds its link.
  await ready(page);
  await page.evaluate(() => window.__termWrite('https://x/' + ')'.repeat(500) + '\r\n'));
  await hoverTerminalText(page, 'https://x/');
  assert.equal(await text(page, '.term-link-hint:not([hidden])'), 'Open https://x/ in the browser');
});

uiTest('finds locations and links in a line of output', async (page) => {
  const found = await page.evaluate(async () => {
    const { findLocations } = await import(new URL('../src/renderer/terminal/locations.js', location.href));
    const lines = [
      'FAILED tests/test_running.py::test_variance - assert 6.0 == 4.0',
      'see https://example.com/a_(b)). Or (https://example.com/c).',
      'stats/running.py:12:5: E501 line too long, at 12:30 on localhost:8000',
      'version 1.2:3 and ./-odd.py:2',
    ];
    return lines.map((line) => findLocations(line).map(({ start, end, ...rest }) => ({ text: line.slice(start, end), ...rest })));
  });
  assert.deepEqual(found, [
    [{ text: 'tests/test_running.py', path: 'tests/test_running.py', line: null }],
    [
      { text: 'https://example.com/a_(b)', url: 'https://example.com/a_(b)' },
      { text: 'https://example.com/c', url: 'https://example.com/c' },
    ],
    [{ text: 'stats/running.py:12:5', path: 'stats/running.py', line: 12 }],
    [{ text: './-odd.py:2', path: './-odd.py', line: 2 }],
  ]);
});
