/**
 * Runs eval tasks with `claude -p` against the Tusche MCP server of this repository (ADR-010).
 *
 *   bun evals/src/run.ts [--tasks id,id] [--label name] [--model m] [--effort e]
 *                        [--max-turns n] [--timeout-min n]
 *
 * Each task runs in a fresh temporary folder outside the repository (so no CLAUDE.md is
 * picked up), with only the `tusche` MCP server (`--strict-mcp-config`), no built-in tools,
 * and no user settings. Results go to `evals/runs/<label>/<task>/`: `task.json`, `work/`
 * (the agent's folder), `calls.jsonl`, `transcript.jsonl`, `stderr.txt`, `score.json`,
 * `renders/`; and `metrics.json` + `summary.md` for the whole label. `--rescore --label <name>`
 * scores the runs of that label again without running the agent.
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createExecutor } from '@tusche/exec';
import { type Score, scoreRun } from './score.ts';
import { metricsOf, summaryMarkdown } from './summary.ts';
import { loadTasks, REPO, type Task } from './tasks.ts';

const DEFAULT_MAX_TURNS = 80;
const DEFAULT_TIMEOUT_MIN = 30;

const { values } = parseArgs({
  options: {
    tasks: { type: 'string' },
    label: { type: 'string' },
    model: { type: 'string' },
    effort: { type: 'string' },
    'max-turns': { type: 'string' },
    'timeout-min': { type: 'string' },
    /** Score the runs of an existing label again without running the agent. */
    rescore: { type: 'boolean' },
  },
});

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
const label = values.label ?? stamp();
const all = loadTasks();
const wanted = values.tasks?.split(',').map((s) => s.trim());
const chosen = wanted ? all.filter((t) => wanted.includes(t.id)) : all;
// Rescoring takes only the tasks that ran under the label.
const tasks = values.rescore
  ? chosen.filter((t) => existsSync(join(REPO, 'evals', 'runs', label, t.id, 'task.json')))
  : chosen;
const unknown = wanted?.filter((id) => !all.some((t) => t.id === id)) ?? [];
if (unknown.length > 0 || tasks.length === 0) {
  console.error(
    `unknown tasks: ${unknown.join(', ') || '(none given)'}; known: ${all.map((t) => t.id).join(', ')}`,
  );
  process.exit(2);
}

const labelDir = join(REPO, 'evals', 'runs', label);
const executor = createExecutor({ save: 'immediate' });

async function runTask(task: Task): Promise<Score> {
  const dir = join(labelDir, task.id);
  if (values.rescore) return scoreRun(dir, task, executor);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'task.json'), `${JSON.stringify(task, null, 2)}\n`);
  // A rerun under the same label starts a fresh journal.
  writeFileSync(join(dir, 'calls.jsonl'), '');
  const work = mkdtempSync(join(tmpdir(), `tusche-eval-${task.id}-`));
  if (task.fixture !== undefined) {
    const target = join(work, task.file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(resolve(REPO, task.fixture), target);
  }
  const config = join(mkdtempSync(join(tmpdir(), 'tusche-eval-mcp-')), 'mcp.json');
  writeFileSync(
    config,
    JSON.stringify({
      mcpServers: {
        tusche: {
          command: process.execPath,
          args: [join(REPO, 'packages', 'cli', 'src', 'index.ts'), 'mcp'],
          env: { TUSCHE_CALL_LOG: join(dir, 'calls.jsonl') },
        },
      },
    }),
  );
  const args = [
    '-p',
    task.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--strict-mcp-config',
    '--mcp-config',
    config,
    '--setting-sources',
    'local',
    '--tools',
    '',
    '--allowedTools',
    'mcp__tusche',
    '--no-session-persistence',
    '--max-turns',
    String(task.maxTurns ?? Number(values['max-turns'] ?? DEFAULT_MAX_TURNS)),
    ...(values.model ? ['--model', values.model] : []),
    ...(values.effort ? ['--effort', values.effort] : []),
  ];
  const started = Date.now();
  const proc = Bun.spawn(['claude', ...args], {
    cwd: work,
    stdin: 'ignore',
    stdout: openSync(join(dir, 'transcript.jsonl'), 'w'),
    stderr: openSync(join(dir, 'stderr.txt'), 'w'),
  });
  const timeout = setTimeout(
    () => proc.kill(),
    Number(values['timeout-min'] ?? DEFAULT_TIMEOUT_MIN) * 60_000,
  );
  const code = await proc.exited;
  clearTimeout(timeout);
  cpSync(work, join(dir, 'work'), { recursive: true });
  const score = await scoreRun(dir, task, executor);
  const minutes = ((Date.now() - started) / 60_000).toFixed(1);
  console.log(
    `${task.id}: exit ${code} · ${minutes} min · file ${score.produced ? 'yes' : 'NO'} · lint ${score.doc?.error ?? '—'}/${score.doc?.warning ?? '—'} · execute ${score.calls?.execute ?? '—'} (failed ${score.calls?.failed ?? '—'}) · tokens ${score.session?.totalTokens ?? '—'}`,
  );
  return score;
}

console.log(`label ${label}: ${tasks.length} task(s) → ${labelDir}`);
const scores: Score[] = [];
for (const task of tasks) scores.push(await runTask(task));
const metrics = await metricsOf(label, scores);
// Rescoring does not run the skill again: the runs keep the version they were made with.
const previous = join(labelDir, 'metrics.json');
if (values.rescore && existsSync(previous)) {
  metrics.skillVersion = JSON.parse(readFileSync(previous, 'utf8')).skillVersion;
}
writeFileSync(join(labelDir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
writeFileSync(join(labelDir, 'summary.md'), summaryMarkdown(metrics));
console.log(summaryMarkdown(metrics));
