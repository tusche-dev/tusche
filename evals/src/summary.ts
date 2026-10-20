import { readSkill } from '@tusche/skill';
import type { Score } from './score.ts';

/** Sums over a set of runs; `null` where no run had the metric. */
export interface Totals {
  tasks: number;
  /** Runs that left no `.pen` file. */
  missing: number;
  /** Sessions that ended with an error (turn limit, API error, …). */
  sessionErrors: number;
  error: number;
  warning: number;
  layout: number;
  fonts: number;
  placeholders: number;
  execute: number | null;
  failed: number | null;
  retries: number | null;
  undo: number | null;
  totalTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  turns: number | null;
  durationMs: number | null;
  editChangedLines: number | null;
  editOutOfScope: number | null;
}

export interface Metrics {
  label: string;
  date: string;
  skillVersion: string;
  model: string | null;
  totals: Totals;
  runs: Score[];
}

const sum = (values: (number | null | undefined)[]): number | null => {
  const known = values.filter((x): x is number => typeof x === 'number');
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
};

export function totals(runs: readonly Score[]): Totals {
  const docs = runs.map((r) => r.doc);
  const edits = runs.filter((r) => r.kind === 'edit');
  return {
    tasks: runs.length,
    missing: runs.filter((r) => !r.produced).length,
    sessionErrors: runs.filter((r) => r.session?.error).length,
    error: sum(docs.map((d) => d?.error)) ?? 0,
    warning: sum(docs.map((d) => d?.warning)) ?? 0,
    layout: sum(docs.map((d) => d?.layout)) ?? 0,
    fonts: sum(docs.map((d) => d?.fonts)) ?? 0,
    placeholders: sum(docs.map((d) => d?.placeholders)) ?? 0,
    execute: sum(runs.map((r) => r.calls?.execute)),
    failed: sum(runs.map((r) => r.calls?.failed)),
    retries: sum(runs.map((r) => r.calls?.retries)),
    undo: sum(runs.map((r) => r.calls?.undo)),
    totalTokens: sum(runs.map((r) => r.session?.totalTokens)),
    outputTokens: sum(runs.map((r) => r.session?.outputTokens)),
    costUsd: sum(runs.map((r) => r.session?.costUsd)),
    turns: sum(runs.map((r) => r.session?.turns)),
    durationMs: sum(runs.map((r) => r.session?.durationMs)),
    editChangedLines: sum(edits.map((r) => r.edit?.changedLines)),
    editOutOfScope: sum(edits.map((r) => r.edit?.outOfScope.length)),
  };
}

/** Version from the front matter of SKILL.md. */
export async function skillVersion(): Promise<string> {
  return /\nversion: (\S+)\n/.exec(await readSkill())?.[1] ?? 'unknown';
}

export async function metricsOf(label: string, runs: Score[]): Promise<Metrics> {
  const models = [...new Set(runs.map((r) => r.session?.model).filter(Boolean))];
  return {
    label,
    date: new Date().toISOString(),
    skillVersion: await skillVersion(),
    model: models.length === 0 ? null : models.join(', '),
    totals: totals(runs),
    runs,
  };
}

const cell = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : String(value);

/** A Markdown table of the runs and the totals. */
export function summaryMarkdown(metrics: Metrics): string {
  const t = metrics.totals;
  const lines = [
    `# Eval run ${metrics.label}`,
    '',
    `Skill ${metrics.skillVersion} · model ${metrics.model ?? 'unknown'} · ${metrics.date}`,
    '',
    '| Task | File | Lint err | Lint warn | Layout | Fonts | Placeholders | execute | Failed | Retries | Undo | Tokens | Turns | Cost $ | Diff lines | Out of scope |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of metrics.runs) {
    lines.push(
      `| ${r.task}${r.session?.error ? ` (${r.session.error})` : ''} | ${r.produced ? 'yes' : '**no**'} | ${cell(r.doc?.error)} | ${cell(r.doc?.warning)} | ${cell(r.doc?.layout)} | ${cell(r.doc?.fonts)} | ${cell(r.doc?.placeholders)} | ${cell(r.calls?.execute)} | ${cell(r.calls?.failed)} | ${cell(r.calls?.retries)} | ${cell(r.calls?.undo)} | ${cell(r.session?.totalTokens)} | ${cell(r.session?.turns)} | ${r.session ? r.session.costUsd.toFixed(2) : '—'} | ${cell(r.edit?.changedLines)} | ${r.edit ? r.edit.outOfScope.join(', ') || '0' : '—'} |`,
    );
  }
  lines.push(
    `| **Total** | ${t.tasks - t.missing}/${t.tasks} | ${t.error} | ${t.warning} | ${t.layout} | ${t.fonts} | ${t.placeholders} | ${cell(t.execute)} | ${cell(t.failed)} | ${cell(t.retries)} | ${cell(t.undo)} | ${cell(t.totalTokens)} | ${cell(t.turns)} | ${t.costUsd === null ? '—' : t.costUsd.toFixed(2)} | ${cell(t.editChangedLines)} | ${cell(t.editOutOfScope)} |`,
    '',
  );
  const codes = new Map<string, number>();
  for (const r of metrics.runs) {
    for (const [code, n] of Object.entries(r.doc?.codes ?? {}))
      codes.set(code, (codes.get(code) ?? 0) + n);
  }
  if (codes.size > 0) {
    lines.push('Lint findings introduced, by code:', '');
    for (const [code, n] of [...codes].sort((a, b) => b[1] - a[1]))
      lines.push(`- \`${code}\` ${n}`);
    lines.push('');
  }
  return lines.join('\n');
}
