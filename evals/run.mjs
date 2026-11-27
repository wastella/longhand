// Sends the prompts in cases.json to the tutor exactly as the app would (config.json, generated
// from the Rust code) over the fixture assignment, and scores each reply: did it contain the
// assignment's code, and did it refuse something it should have answered.
//
// This spends your Claude subscription: one CLI run per case per policy (about 80 for the full
// set). See README.md.
//
//   node evals/run.mjs --dry-run                       list what would run
//   node evals/run.mjs --only lookup-tril,direct-softmax --policy strict
//   node evals/run.mjs                                 everything, both policies
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { score } from './score.mjs';

const here = new URL('./', import.meta.url);
const config = JSON.parse(readFileSync(new URL('config.json', here), 'utf8'));
const cases = JSON.parse(readFileSync(new URL('cases.json', here), 'utf8'));
const fixture = new URL('fixture/', here).pathname;

const { values } = parseArgs({
  options: {
    policy: { type: 'string', default: 'both' },
    only: { type: 'string' },
    'dry-run': { type: 'boolean' },
    claude: { type: 'string' },
    concurrency: { type: 'string', default: '2' },
  },
});

const policies = values.policy === 'both' ? ['strict', 'guided'] : [values.policy];
const only = values.only ? new Set(values.only.split(',')) : null;
const runs = policies.flatMap((policy) =>
  cases.filter((c) => (!only || only.has(c.id)) && !(c.guidedOnly && policy === 'strict')).map((c) => ({ ...c, kind: c.kind || 'conversation', policy })),
);

const claude = values.claude || [`${homedir()}/.local/bin/claude`, '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find(existsSync) || 'claude';
const READ_ONLY = ['Read', 'Glob', 'Grep'];

/** One CLI run, the way src-tauri/src/tutor/run.rs drives it. Resolves with the reply text. */
function ask(run) {
  const args = config.args[run.kind].map((a) => (a === '{{SYSTEM_PROMPT}}' ? config.systemPrompts[run.policy][run.kind] : a));
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return new Promise((resolve) => {
    const child = spawn(claude, args, { cwd: fixture, env });
    let text = '';
    let buffer = '';
    let error = '';
    const handle = (m) => {
      const top = !m.parent_tool_use_id;
      if (m.type === 'system' && m.subtype === 'init' && m.tools.some((t) => !READ_ONLY.includes(t))) {
        error = `unexpected tools: ${m.tools}`;
        child.kill();
      } else if (m.type === 'stream_event' && top && m.event.type === 'content_block_start' && m.event.content_block.type === 'text' && text) text += '\n\n';
      else if (m.type === 'stream_event' && top && m.event.type === 'content_block_delta' && m.event.delta.type === 'text_delta') text += m.event.delta.text;
      else if (m.type === 'result' && m.is_error) error = m.result || (m.errors || []).join('\n');
    };
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        try {
          handle(JSON.parse(line));
        } catch {
          // Not a JSON line; the CLI prints nothing else on stdout in this mode.
        }
      }
    });
    child.stderr.on('data', (chunk) => (error += chunk));
    child.on('close', () => resolve({ text: text.trim(), error: error.trim() }));
    child.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content: run.prompt } }) + '\n');
  });
}

if (values['dry-run']) {
  for (const r of runs) console.log(`${r.policy.padEnd(7)} ${r.kind.padEnd(13)} ${r.expect.padEnd(8)} ${r.id}`);
  console.log(`\n${runs.length} CLI runs`);
  process.exit(0);
}

const results = [];
let next = 0;
async function worker() {
  while (next < runs.length) {
    const run = runs[next++];
    const reply = await ask(run);
    const verdict = reply.error ? { pass: false, problem: `error: ${reply.error.split('\n')[0]}` } : score(run, reply.text);
    results.push({ ...run, reply: reply.text, ...verdict });
    console.log(`${verdict.pass ? 'pass' : 'FAIL'}  ${run.policy.padEnd(7)} ${run.id}${verdict.problem ? `  (${verdict.problem})` : ''}`);
  }
}
await Promise.all(Array.from({ length: Number(values.concurrency) }, worker));

const pad = (value, width) => String(value).padStart(width);
console.log('\npolicy   category                  runs  leaked code  wrong refusal  pass');
for (const policy of policies) {
  const mine = results.filter((r) => r.policy === policy);
  const groups = Object.entries(Object.groupBy(mine, (r) => r.category));
  for (const [category, rs] of [...groups, ['all', mine]]) {
    const count = (f) => rs.filter(f).length;
    console.log(
      `${policy.padEnd(8)} ${category.padEnd(25)} ${pad(rs.length, 4)}  ${pad(
        count((r) => r.leaked),
        11,
      )}  ${pad(
        count((r) => r.wrongRefusal),
        13,
      )}  ${pad(
        count((r) => r.pass),
        4,
      )}`,
    );
  }
}

mkdirSync(new URL('results/', here), { recursive: true });
const out = new URL(`results/${new Date().toISOString().replace(/[:.]/g, '-')}.json`, here);
writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`\nReplies saved to ${out.pathname}. Read them: the scores are heuristics.`);
