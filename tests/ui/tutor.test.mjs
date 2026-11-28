import assert from 'node:assert/strict';
import { askTutor, count, isHidden, openFromTree, sleep, text, uiTest } from './helpers.mjs';

const lastAsked = (page) => page.evaluate(() => window.__asked.at(-1));
const THREE_DAYS = Math.floor(Date.now() / 1000) + 3 * 86400;
const ATTACK = '.msg.tutor script, .msg.tutor img, .msg.tutor iframe, .msg.tutor a[href], .msg.tutor [onclick], .msg.tutor [onerror]';

uiTest('the student can leave the open file out of the next question', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await page.click('#context-chips .chip.file .chip-remove');
  assert.match(await text(page, '#context-chips'), /Sees only your question/);
  await askTutor(page, 'What is a running variance?');
  const sent = await lastAsked(page);
  assert.equal(sent.prompt, 'What is a running variance?');
  assert.deepEqual(sent.context, []);
  assert.match(await text(page, '#context-chips'), /running\.py/, 'the file is offered again for the question after');
});

uiTest('the open file and selection travel with a question', async (page) => {
  await openFromTree(page, 'stats/running.py');
  await page.click('.cm-content');
  // Select all: Cmd on macOS, Ctrl elsewhere.
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.down(mod);
  await page.keyboard.press('a');
  await page.keyboard.up(mod);
  assert.match(await text(page, '#context-chips'), /running\.py.*lines 1–\d+/);
  await askTutor(page, 'What does this class keep?');
  const sent = await lastAsked(page);
  assert.match(sent.prompt, /Open file: stats\/running\.py/);
  assert.match(sent.prompt, /Selected lines 1-\d+:/);
  assert.equal(sent.about, 'question');
});

uiTest('code beyond the strict limit is hidden until revealed, and the reveal is counted', async (page) => {
  await askTutor(page, 'please include code');
  assert.equal(await count(page, '.msg.tutor .withheld'), 1);
  assert.equal(await count(page, '.msg.tutor pre'), 1, 'the shell command stays visible');
  assert.doesNotMatch(await text(page, '.msg.tutor'), /def push/);
  await page.click('.msg.tutor .withheld button');
  await page.waitForFunction(() => document.querySelectorAll('.msg.tutor pre').length === 2);
  assert.equal(await page.evaluate(() => window.__log.filter((e) => e.kind === 'reveal').length), 1);
});

// Each answer below carries three lines of a softmax past a check that looked only at fenced
// blocks one at a time. Strict allows two lines in an answer, counted across all of it.
for (const [way, how] of Object.entries({
  texttt: 'in \\texttt rows of a display formula',
  verb: 'in \\verb inside a matrix',
  split: 'split across three one-line blocks',
  bash: 'in a fence marked bash',
  table: 'one line per table row',
  breaks: 'in inline code joined by hard line breaks',
  raw: 'in raw <code> with <br>',
})) {
  uiTest(`code ${how} is hidden too, and revealed all at once`, async (page) => {
    await askTutor(page, `smuggle ${way}`);
    const answer = await text(page, '.msg.tutor .answer-body');
    assert.doesNotMatch(answer, /x\.max|exp\(|\.exp|softmax\(-1\)/, answer);
    assert.equal(await count(page, '.msg.tutor .withheld button'), 1, 'one Reveal for the whole answer');
    assert.match(await text(page, '.msg.tutor .withheld:has(button)'), /3 lines of code, hidden under the strict policy/);
    await page.click('.msg.tutor .withheld button');
    await page.waitForFunction(() => !document.querySelector('.msg.tutor .withheld'));
    assert.match(await text(page, '.msg.tutor .answer-body'), /max/);
    assert.deepEqual(await page.evaluate(() => window.__logged.map((l) => [l.kind, l.detail.lines])), [['reveal', 3]]);
  });
}

uiTest('a table of function signatures and ordinary math are not hidden', async (page) => {
  await askTutor(page, 'smuggle api');
  assert.equal(await count(page, '.msg.tutor .withheld'), 0);
  assert.match(await text(page, '.msg.tutor table'), /torch\.tril\(input, diagonal=0\)/);
  await askTutor(page, 'explain the math');
  assert.equal(await count(page, '.msg.tutor .withheld'), 0);
});

uiTest('a formula cannot draw outside its own box', async (page) => {
  await askTutor(page, 'raisebox');
  const { formula, panel } = await page.evaluate(() => {
    const box = (n) => n.getBoundingClientRect().toJSON();
    const math = document.querySelector('.msg.tutor .math');
    // The formula's painted area is clipped to its box, which stays within the answer.
    return { formula: { ...box(math), contain: getComputedStyle(math).contain }, panel: box(document.querySelector('.msg.tutor')) };
  });
  assert.match(formula.contain, /paint/);
  assert.ok(formula.right <= panel.right + 1 && formula.left >= panel.left - 1, JSON.stringify({ formula, panel }));
  assert.ok(formula.height < 200, `a lowered maxSize keeps the box small (${formula.height}px)`);
});

uiTest('the guided policy shows short examples, with syntax colours', async (page) => {
  await page.click('#policy [data-policy="guided"]');
  await page.waitForFunction(() => document.querySelector('#policy [data-policy="guided"]').getAttribute('aria-pressed') === 'true');
  assert.match(await text(page, '#course-note'), /Guided/);
  await askTutor(page, 'please include code');
  assert.equal(await count(page, '.msg.tutor .withheld'), 0);
  assert.equal(await count(page, '.msg.tutor pre'), 2);
  assert.equal(await text(page, '.msg.tutor pre code.language-python .code-keyword'), 'def');
  assert.equal(await text(page, '.msg.tutor pre code.language-python .code-function'), 'push');
  // The same colours as the editor: its --color-code-* tokens, not a set of the tutor's own.
  const sameAsEditor = await page.evaluate(() =>
    ['keyword', 'function', 'number'].every((name) => {
      const probe = Object.assign(document.createElement('span'), { style: `color: var(--color-code-${name})` });
      document.body.append(probe);
      const same = getComputedStyle(document.querySelector(`.msg.tutor .code-${name}`)).color === getComputedStyle(probe).color;
      probe.remove();
      return same;
    }),
  );
  assert.equal(sameAsEditor, true);
  assert.match(await text(page, '.msg.tutor pre code.language-python'), /self\.total \+= x/, 'highlighting keeps the text intact');
});

uiTest('tutor answers cannot inject markup or navigate the window', async (page) => {
  await askTutor(page, 'please be hostile');
  assert.equal(await count(page, ATTACK), 0);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  // Nor dress up as the app: no classes of ours, no ids, no URL attributes, no image maps.
  assert.equal(await count(page, '.msg.tutor .answer-body [class]:not(code, .math, .math-display, .katex *, .katex, [class^="code-"])'), 0);
  assert.equal(await count(page, '.msg.tutor .sheet-backdrop, .msg.tutor [id], .msg.tutor [background], .msg.tutor area, .msg.tutor map'), 0);
  assert.equal(await count(page, '#input'), 1);
  assert.match(await text(page, '.msg.tutor .answer-body'), /A fake sheet over the app/);
  assert.equal(await page.$eval('.msg.tutor .answer-body', (n) => getComputedStyle(n).contain), 'layout paint');
});

uiTest('math renders, while prices and code stay as written', async (page) => {
  await askTutor(page, 'explain the math');
  assert.equal(await count(page, '.msg.tutor .math .katex'), 3);
  assert.equal(await count(page, '.msg.tutor .math-display .katex-display'), 1);
  const answer = await text(page, '.msg.tutor .answer-body');
  assert.match(answer, /costs \$5 to \$10 of nothing/);
  assert.equal(await text(page, '.msg.tutor p:last-child code'), '$HOME');
});

uiTest('math cannot be used to inject markup, styles or links', async (page) => {
  await askTutor(page, 'math hostile');
  assert.equal(await count(page, ATTACK + ', .msg.tutor .pwn'), 0);
  const styles = await page.$$eval('.msg.tutor [style]', (nodes) => nodes.map((n) => n.getAttribute('style')).join(' '));
  assert.doesNotMatch(styles, /position|url\(|inset/);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.doesNotMatch(await text(page, '.msg.tutor'), /spoof.*\\mathrm/);
});

uiTest('copy takes the answer as shown, with hidden code still hidden', async (page) => {
  await page.evaluate(() => {
    window.__copied = null;
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => (window.__copied = t) } });
  });
  await askTutor(page, 'please include code');
  await page.hover('.msg.tutor');
  await page.click('.msg.tutor .copy');
  await page.waitForFunction(() => window.__copied);
  const copied = await page.evaluate(() => window.__copied);
  assert.match(copied, /uv run pytest/);
  assert.match(copied, /\[code hidden by the policy\]/);
  assert.doesNotMatch(copied, /def push/);
  assert.equal(await text(page, '.msg.tutor .copy'), 'Copied');
});

uiTest('Stop ends a long answer, and scrolling up stops the panel following it', async (page) => {
  await page.type('#input', 'a long answer please');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /Paragraph 16/.test(document.querySelector('.msg.tutor').textContent));
  await page.$eval('#chat', (chat) => (chat.scrollTop = 0) || chat.dispatchEvent(new Event('scroll')));
  await sleep(200);
  assert.equal(await page.$eval('#chat', (chat) => chat.scrollTop), 0, 'the student keeps their place');
  await page.click('#stop');
  await page.waitForSelector('#chat .note');
  assert.equal(await text(page, '#chat .note'), 'Stopped.');
  assert.equal(await isHidden(page, '#send'), false);
  assert.doesNotMatch(await text(page, '.msg.tutor'), /Paragraph 30/);
});

uiTest(
  'a usage limit says when it resets, and Retry asks again without repeating the question',
  async (page) => {
    await askTutor(page, 'What is AdamW?');
    await page.waitForSelector('.msg.error');
    // "at 3:40 pm" today; on another day the date comes first.
    assert.match(await text(page, '.msg.error'), /usage limit\. It resets (at|on .+ at) \d{1,2}:\d{2}/);
    await page.click('.msg.error .retry');
    await page.waitForFunction(() => !document.querySelector('.msg.error') && document.querySelector('.msg.tutor'));
    await page.waitForFunction(() => !document.querySelector('#send').hidden);
    const sent = await lastAsked(page);
    assert.equal(sent.retry, true);
    assert.equal(sent.prompt, 'What is AdamW?');
    assert.equal(await count(page, '.msg.user'), 1);
  },
  { tutor: { failures: [{ code: 'rate-limited', message: 'You have reached your Claude usage limit.', resetsAt: Math.floor(Date.now() / 1000) + 3600 }] } },
);

uiTest(
  'a usage limit that resets on another day says which day',
  async (page) => {
    await askTutor(page, 'What is AdamW?');
    await page.waitForSelector('.msg.error');
    const expected = await page.evaluate((s) => new Date(s * 1000).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }), THREE_DAYS);
    assert.ok((await text(page, '.msg.error')).includes(`It resets on ${expected} at `), await text(page, '.msg.error'));
  },
  { tutor: { failures: [{ code: 'rate-limited', message: 'You have reached your Claude usage limit.', resetsAt: THREE_DAYS }] } },
);

uiTest(
  'a logged-out CLI explains what to do and offers to check again',
  async (page) => {
    await askTutor(page, 'What is AdamW?');
    await page.waitForSelector('.msg.error');
    assert.match(await text(page, '.msg.error'), /not logged in.*claude/);
    assert.equal(await count(page, '.msg.error .retry'), 0, 'retrying cannot help until the student logs in');
    assert.equal(await count(page, '.msg.error button'), 1);
  },
  { tutor: { failures: [{ code: 'logged-out', message: 'Claude Code is not logged in. Run `claude` in the terminal, log in, then try again.' }] } },
);

uiTest(
  "the folder's last conversation comes back, and earlier ones are listed",
  async (page) => {
    await page.waitForFunction(() => document.querySelectorAll('#chat .msg').length === 2);
    assert.match(await text(page, '#chat .msg.user'), /What does a causal mask do/);
    assert.match(await text(page, '#chat .msg.tutor'), /attend/);
    await askTutor(page, 'And why does it use -inf?');
    assert.equal((await lastAsked(page)).thread, 'conv-yesterday');

    await page.click('#new-chat');
    assert.equal(await count(page, '#chat .empty'), 1);
    await askTutor(page, 'What is a residual stream?');
    const fresh = (await lastAsked(page)).thread;
    assert.match(fresh, /^conv-/);
    assert.notEqual(fresh, 'conv-yesterday');

    await page.click('#show-history');
    await page.waitForSelector('#history-list .thread');
    assert.equal(await count(page, '#history-list .thread'), 2);
    assert.match(await text(page, '#history-list .thread.active'), /residual stream/);
    assert.match(await text(page, '#history .storage-note'), /Conversations and lookups are kept in this folder/);
    await page.click('#history-list .thread:not(.active)');
    await page.waitForFunction(() => document.querySelector('#history').hidden && !document.querySelector('#chat').hidden);
    assert.match(await text(page, '#chat'), /causal mask[\s\S]*-inf/);
  },
  {
    tutor: {
      threads: {
        'conv-yesterday': {
          id: 'conv-yesterday',
          kind: 'conversation',
          title: 'What does a causal mask do?',
          created: '2026-11-26T10:00:00Z',
          updated: '2026-11-26T10:01:00Z',
          messages: [
            { role: 'student', text: 'What does a causal mask do?', at: '2026-11-26T10:00:00Z' },
            { role: 'tutor', text: 'It stops each position from attending to later ones.', at: '2026-11-26T10:01:00Z' },
          ],
        },
      },
    },
  },
);

uiTest('Tutor > Show or Hide Record opens the record, even with the panel hidden', async (page) => {
  await askTutor(page, 'What is a residual stream?');
  await page.evaluate(() => window.__emit('menu', 'toggle-tutor'));
  assert.equal(await isHidden(page, '#tutor'), true);
  await page.evaluate(() => window.__emit('menu', 'show-record'));
  assert.equal(await isHidden(page, '#tutor'), false);
  await page.waitForSelector('#record .record-day');
  assert.equal(await isHidden(page, '#chat'), true);
  assert.doesNotMatch(await text(page, '#record'), /streak|score|great/i);
  // The fixture's 3 earlier questions and this one.
  assert.match(await text(page, '#record'), /Today4 questions/);
  assert.match(await text(page, '#record .storage-note'), /kept in this folder, in \.longhand\/threads\/.*Git ignores them.*delete/);
  await page.keyboard.press('Escape');
  assert.equal(await isHidden(page, '#chat'), false);
  await page.evaluate(() => window.__emit('menu', 'show-record'));
  assert.equal(await isHidden(page, '#record'), false);
  await page.evaluate(() => window.__emit('menu', 'show-record'));
  assert.equal(await isHidden(page, '#chat'), false, 'asking again goes back to the conversation');
});

uiTest('the panel header holds the policy, History and New, and nothing above the question box', async (page) => {
  assert.deepEqual(await page.$$eval('#tutor .pane-head button', (nodes) => nodes.map((n) => n.textContent)), ['Strict', 'Guided', 'History', 'New']);
  assert.equal(await count(page, '#quick, #hints, #stuck, #show-record'), 0);
  assert.match(await text(page, '#chat .empty'), /review of the open file press ⇧⌘R/);
});

uiTest(
  'hints asked for by older versions still show in the record',
  async (page) => {
    await page.evaluate(() => window.__emit('menu', 'show-record'));
    await page.waitForSelector('#record .record-day');
    assert.match(await text(page, '#record'), /2 hints/);
  },
  { tutor: { pastDays: [{ date: '2026-01-05', asks: { hint: 2 }, reveals: 0 }] } },
);

uiTest('the lookup bar answers in a popover that is not part of the conversation', async (page) => {
  await page.evaluate(() => window.__emit('menu', 'lookup'));
  assert.equal(await isHidden(page, '#lookup'), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'lookup-input');
  assert.equal(await page.evaluate(() => window.__prepared), 1, 'the CLI is started while the student types');
  await page.type('#lookup-input', 'what does torch.tril return');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /diagonal set to zero/.test(document.querySelector('#lookup-answer').textContent));
  const sent = await lastAsked(page);
  assert.deepEqual([sent.kind, sent.about, sent.prompt, sent.ephemeral], ['lookup', 'lookup', 'what does torch.tril return', undefined]);
  assert.match(sent.thread, /^lookup-\d{4}-\d{2}-\d{2}$/, "today's lookup thread");
  await page.waitForFunction((id) => window.__threads[id]?.messages.length === 2, {}, sent.thread);
  assert.equal(await count(page, '#chat .msg'), 0);
  await page.keyboard.press('Escape');
  assert.equal(await isHidden(page, '#lookup'), true);
});

uiTest('Escape closes the lookup bar even when the focus is somewhere else', async (page) => {
  await page.evaluate(() => window.__emit('menu', 'lookup'));
  assert.equal(await isHidden(page, '#lookup'), false);
  // Focus leaves the bar without a click it could see, as when another window takes it.
  await page.evaluate(() => document.querySelector('#lookup-input').blur());
  await page.keyboard.press('Escape');
  assert.equal(await isHidden(page, '#lookup'), true);
});

uiTest('every kind of question is counted in the record', async (page) => {
  const asks = () => window.__log.filter((e) => e.kind === 'ask').length;
  assert.equal(await page.evaluate(asks), 3, "the fixture's log");
  await askTutor(page, 'What is a residual stream?');
  await page.waitForFunction(() => window.__log.filter((e) => e.kind === 'ask').length === 4);
  await page.evaluate(() => window.__emit('menu', 'lookup'));
  await page.type('#lookup-input', 'what does torch.tril return');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__log.filter((e) => e.kind === 'ask').length === 5);
  await page.keyboard.press('Escape');
  assert.deepEqual(
    await page.evaluate(() => window.__log.filter((e) => e.kind === 'ask').map((e) => e.about)),
    ['question', 'question', 'question', 'question', 'lookup'],
    'each question is logged as an ask, whatever its kind',
  );
  await page.evaluate(() => window.__emit('menu', 'show-record'));
  await page.waitForSelector('#record .record-day');
  assert.match(await text(page, '#record'), /Today4 questions · 1 lookup/);
});

uiTest('lookups go through the hidden-code check too', async (page) => {
  await page.evaluate(() => window.__emit('menu', 'lookup'));
  await page.type('#lookup-input', 'please include code');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#lookup-answer .withheld button');
  assert.doesNotMatch(await text(page, '#lookup-answer'), /def push/);
});

uiTest(
  'without Claude Code the tutor shows setup steps and the editor still works',
  async (page) => {
    assert.equal(await isHidden(page, '#setup'), false);
    assert.equal(await isHidden(page, '#ask'), true);
    assert.equal(await count(page, '#setup-steps li'), 3);
    assert.match(await text(page, '#auth'), /not found/);
    await openFromTree(page, 'stats/running.py');
    assert.equal(await count(page, '#tabs .tab'), 1);
    await page.evaluate(() => (window.__MOCK__.auth = { installed: true, loggedIn: true, plan: 'pro' }));
    await page.click('#setup-check');
    await page.waitForFunction(() => document.querySelector('#setup').hidden);
    assert.equal(await text(page, '#auth'), 'Claude Pro');
    assert.equal(await isHidden(page, '#ask'), false);
  },
  { auth: { installed: false, loggedIn: false } },
);

uiTest(
  'a Claude Code too old for the read-only flags asks to be updated',
  async (page) => {
    assert.equal(await isHidden(page, '#setup'), false);
    assert.match(await text(page, '#setup'), /1\.0\.3 is installed but too old/);
    assert.match(await text(page, '#setup-steps'), /claude update/);
    assert.equal(await count(page, '#setup-steps li'), 2);
  },
  { auth: { installed: true, loggedIn: true, tooOld: true, version: '1.0.3', missing: ['--restricted'] } },
);
