/**
 * Scores one eval run (stage 1.6, ADR-010).
 *
 *   bun evals/src/score.ts <run-dir>                       a run made by run.ts
 *   bun evals/src/score.ts --task <id> --pen <file> [--out <dir>]   a file made by hand
 *
 * A run folder holds `task.json`, the agent's working folder `work/`, and optionally
 * `calls.jsonl` (the MCP call journal) and `transcript.jsonl` (`claude -p` stream-json).
 * Missing parts give `null` metrics. Writes `score.json` and PNG renders to `renders/`.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createExecutor, type Executor, type LintIssue, lintDocument } from '@tusche/exec';
import { migratePen, parsePen, serializePen } from '@tusche/pen-format';
import { changedLines, outOfScope } from './diff.ts';
import { loadTasks, REPO, type Task } from './tasks.ts';

/** Warning codes about layout. */
export const LAYOUT_CODES = [
  'clipped',
  'zero-size',
  'ignored-xy',
  'invisible-text',
  'circular-size',
];
/** Warning codes about fonts. */
export const FONT_CODES = ['missing-glyphs', 'unknown-font'];
/** At most this many top-level nodes are rendered per run. */
const MAX_RENDERS = 12;

export interface DocMetrics {
  roots: number;
  nodes: number;
  /** Top-level frames still marked `placeholder: true`. */
  placeholders: number;
  /** Lint findings the agent introduced (not in the file it started from), by level. */
  error: number;
  warning: number;
  /** Introduced findings with a layout code. */
  layout: number;
  /** Introduced findings with a font code. */
  fonts: number;
  /** Introduced findings by code. */
  codes: Record<string, number>;
}

export interface CallMetrics {
  total: number;
  execute: number;
  /** `execute` calls that failed (rolled back). */
  failed: number;
  /** `execute` calls fixing a failed one through `editId`. */
  retries: number;
  undo: number;
  render: number;
  lint: number;
  /** Skill files read, in order. */
  skill: string[];
  /** Styles asked for by name. */
  styles: string[];
}

export interface SessionMetrics {
  model: string | null;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** All four token counts added. */
  totalTokens: number;
  costUsd: number;
  durationMs: number;
  /** The session ended with an error (turn limit, API error, …). */
  error: string | null;
}

export interface EditMetrics {
  changedLines: number;
  /** Top-level ids (or `variables`) changed outside the task's scope. */
  outOfScope: string[];
}

export interface Score {
  task: string;
  kind: Task['kind'];
  /** The `.pen` file exists after the run. */
  produced: boolean;
  doc: DocMetrics | null;
  calls: CallMetrics | null;
  session: SessionMetrics | null;
  edit: EditMetrics | null;
  /** Rendered PNGs, relative to the run folder. */
  renders: string[];
}

interface PenNodeLike {
  id?: string;
  type?: string;
  placeholder?: boolean;
  children?: PenNodeLike[];
}

const countNodes = (nodes: PenNodeLike[] = []): number =>
  nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);

const issueKey = (issue: LintIssue) => `${issue.code}\0${issue.path ?? ''}`;

/** Lint findings of `after` that `before` did not have (same code on the same node). */
function introduced(before: readonly LintIssue[], after: readonly LintIssue[]): LintIssue[] {
  const left = new Map<string, number>();
  for (const issue of before) left.set(issueKey(issue), (left.get(issueKey(issue)) ?? 0) + 1);
  return after.filter((issue) => {
    const n = left.get(issueKey(issue)) ?? 0;
    if (n === 0) return true;
    left.set(issueKey(issue), n - 1);
    return false;
  });
}

/** The fixture as Tusche writes it on the first change (migrated): the reference for the diff. */
function reference(fixture: string): string {
  const parsed = parsePen(readFileSync(resolve(REPO, fixture), 'utf8'));
  return serializePen(migratePen(parsed.doc).doc, parsed.format);
}

function readJsonLines(file: string): Record<string, unknown>[] | null {
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function callMetrics(entries: Record<string, unknown>[]): CallMetrics {
  const of = (tool: string) => entries.filter((e) => e.tool === tool);
  const execute = of('execute');
  return {
    total: entries.length,
    execute: execute.length,
    failed: execute.filter((e) => e.ok === false).length,
    retries: execute.filter((e) => typeof e.retryOf === 'string').length,
    undo: of('undo').length,
    render: of('render').length,
    lint: of('lint').length,
    skill: of('read_skill').map((e) => String(e.path)),
    styles: of('get_style')
      .filter((e) => typeof e.style === 'string')
      .map((e) => String(e.style)),
  };
}

export function sessionMetrics(events: Record<string, unknown>[]): SessionMetrics | null {
  const result = events.findLast((e) => e.type === 'result');
  if (!result) return null;
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
  const usage = (result.usage ?? {}) as Record<string, number>;
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const creation = usage.cache_creation_input_tokens ?? 0;
  return {
    model: typeof init?.model === 'string' ? init.model : null,
    turns: Number(result.num_turns ?? 0),
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: read,
    cacheCreationTokens: creation,
    totalTokens: input + output + read + creation,
    costUsd: Number(result.total_cost_usd ?? 0),
    durationMs: Number(result.duration_ms ?? 0),
    error: result.is_error === true || result.subtype !== 'success' ? String(result.subtype) : null,
  };
}

/** Scores the run in `dir` and writes `score.json` and `renders/`. */
export async function scoreRun(dir: string, task: Task, executor?: Executor): Promise<Score> {
  const exec = executor ?? createExecutor({ save: 'immediate' });
  const file = join(dir, 'work', task.file);
  const score: Score = {
    task: task.id,
    kind: task.kind,
    produced: existsSync(file),
    doc: null,
    calls: null,
    session: null,
    edit: null,
    renders: [],
  };
  const calls = readJsonLines(join(dir, 'calls.jsonl'));
  if (calls) score.calls = callMetrics(calls);
  const events = readJsonLines(join(dir, 'transcript.jsonl'));
  if (events) score.session = sessionMetrics(events);

  if (score.produced) {
    // Scored on a copy: the session must not touch the agent's file.
    const copyDir = mkdtempSync(join(tmpdir(), 'tusche-eval-score-'));
    const copy = join(copyDir, 'scored.pen');
    copyFileSync(file, copy);
    const text = readFileSync(copy, 'utf8');
    const doc = JSON.parse(text) as { children?: PenNodeLike[] };

    let before: LintIssue[] = [];
    if (task.fixture !== undefined) {
      const ref = reference(task.fixture);
      const refFile = join(copyDir, 'reference.pen');
      writeFileSync(refFile, ref);
      const refSession = await exec.open(refFile);
      before = await lintDocument(refSession);
      await exec.close(refFile);
      score.edit = {
        changedLines: changedLines(ref, text),
        outOfScope: outOfScope(JSON.parse(ref), doc, task.scope ?? []),
      };
    }

    const session = await exec.open(copy);
    const fresh = introduced(before, await lintDocument(session));
    const codes: Record<string, number> = {};
    for (const issue of fresh) codes[issue.code] = (codes[issue.code] ?? 0) + 1;
    const roots = doc.children ?? [];
    score.doc = {
      roots: roots.length,
      nodes: countNodes(roots),
      placeholders: roots.filter((n) => n.placeholder === true).length,
      error: fresh.filter((i) => i.level === 'error').length,
      warning: fresh.filter((i) => i.level === 'warning').length,
      layout: fresh.filter((i) => LAYOUT_CODES.includes(i.code)).length,
      fonts: fresh.filter((i) => FONT_CODES.includes(i.code)).length,
      codes,
    };

    const shown = (
      task.kind === 'edit' ? roots.filter((n) => task.scope?.includes(n.id ?? '')) : roots
    )
      .filter((n) => n.id !== undefined)
      .slice(0, MAX_RENDERS);
    mkdirSync(join(dir, 'renders'), { recursive: true });
    for (const [i, node] of shown.entries()) {
      const png = await session.scene.render([node.id as string], { scale: 1, maxSide: 1600 });
      if (!png) continue;
      const name = `renders/${String(i + 1).padStart(2, '0')}-${node.id}.png`;
      writeFileSync(join(dir, name), png);
      score.renders.push(name);
    }
    await exec.close(copy);
  }
  writeFileSync(join(dir, 'score.json'), `${JSON.stringify(score, null, 2)}\n`);
  return score;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { task: { type: 'string' }, pen: { type: 'string' }, out: { type: 'string' } },
  });
  const tasks = loadTasks();
  let dir: string;
  let task: Task | undefined;
  if (values.pen !== undefined) {
    task = tasks.find((t) => t.id === values.task);
    if (!task) throw new Error(`--task: one of ${tasks.map((t) => t.id).join(', ')}`);
    dir = resolve(values.out ?? join(REPO, 'evals', 'runs', 'manual', task.id));
    const target = join(dir, 'work', task.file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(resolve(values.pen), target);
    writeFileSync(join(dir, 'task.json'), `${JSON.stringify(task, null, 2)}\n`);
  } else {
    if (positionals.length !== 1) {
      console.error('usage: score.ts <run-dir> | --task <id> --pen <file> [--out <dir>]');
      process.exit(2);
    }
    dir = resolve(positionals[0] as string);
    task = JSON.parse(readFileSync(join(dir, 'task.json'), 'utf8')) as Task;
  }
  const score = await scoreRun(dir, task);
  console.log(JSON.stringify(score, null, 2));
}
