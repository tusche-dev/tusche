/**
 * Compares a run with the baseline (ADR-010): a skill change is accepted only if the
 * automatic metrics did not get worse.
 *
 *   bun evals/src/compare.ts evals/baseline/metrics.json evals/runs/<label>/metrics.json
 *
 * Exit 0 when nothing got worse, 1 otherwise, 2 on bad input.
 */
import { readFileSync } from 'node:fs';
import type { Metrics, Totals } from './summary.ts';

/** Lower is better for every metric; `tolerance` is the relative growth still accepted. */
export const RULES: { key: keyof Totals; tolerance: number }[] = [
  { key: 'missing', tolerance: 0 },
  { key: 'sessionErrors', tolerance: 0 },
  { key: 'error', tolerance: 0 },
  { key: 'warning', tolerance: 0 },
  { key: 'layout', tolerance: 0 },
  { key: 'fonts', tolerance: 0 },
  { key: 'placeholders', tolerance: 0 },
  { key: 'failed', tolerance: 0 },
  { key: 'editOutOfScope', tolerance: 0 },
  { key: 'editChangedLines', tolerance: 0.15 },
  { key: 'totalTokens', tolerance: 0.15 },
];

export interface Comparison {
  key: keyof Totals;
  baseline: number | null;
  current: number | null;
  worse: boolean;
}

export function compare(baseline: Metrics, current: Metrics): Comparison[] {
  return RULES.map(({ key, tolerance }) => {
    const before = baseline.totals[key];
    const after = current.totals[key];
    const worse =
      typeof before === 'number' && typeof after === 'number' && after > before * (1 + tolerance);
    return { key, baseline: before, current: after, worse };
  });
}

/** Task ids present in only one of the two runs. */
export function taskMismatch(baseline: Metrics, current: Metrics): string[] {
  const a = new Set(baseline.runs.map((r) => r.task));
  const b = new Set(current.runs.map((r) => r.task));
  return [...a, ...b].filter((id) => !(a.has(id) && b.has(id)));
}

if (import.meta.main) {
  const [basePath, currentPath] = process.argv.slice(2);
  if (!basePath || !currentPath) {
    console.error('usage: compare.ts <baseline metrics.json> <run metrics.json>');
    process.exit(2);
  }
  const baseline = JSON.parse(readFileSync(basePath, 'utf8')) as Metrics;
  const current = JSON.parse(readFileSync(currentPath, 'utf8')) as Metrics;
  const mismatch = taskMismatch(baseline, current);
  if (mismatch.length > 0) {
    console.error(`the runs have different tasks: ${mismatch.join(', ')}`);
    process.exit(2);
  }
  console.log(
    `baseline ${baseline.label} (skill ${baseline.skillVersion}) → ${current.label} (skill ${current.skillVersion})`,
  );
  const rows = compare(baseline, current);
  for (const row of rows) {
    const mark = row.worse ? 'WORSE' : 'ok';
    console.log(
      `${mark.padEnd(6)}${row.key.padEnd(18)}${String(row.baseline).padStart(10)} → ${row.current}`,
    );
  }
  const worse = rows.filter((r) => r.worse);
  console.log(
    worse.length === 0
      ? 'accepted: no metric got worse'
      : `rejected: ${worse.length} metric(s) got worse`,
  );
  process.exit(worse.length === 0 ? 0 : 1);
}
