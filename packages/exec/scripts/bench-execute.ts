/**
 * Timings of `execute` (stage 1.4): a synthetic document of 1000 nodes and real files.
 *
 *   bun packages/exec/scripts/bench-execute.ts [file.pen …]
 *
 * Every file is copied to a temporary folder first: the originals are never opened for
 * writing. Prints a Markdown table; times are medians of ROUNDS runs (ms).
 */
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createEngine } from '@tusche/engine';
import { createExecutor, type DocumentSession } from '../src/index.ts';

const ROUNDS = 5;
const dir = mkdtempSync(join(tmpdir(), 'tusche-bench-'));

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
};

/** 1000 nodes: 10 boards × 9 cards × (frame + text + 9 rectangles), plus the boards. */
function synthetic(): string {
  const boards = Array.from({ length: 10 }, (_, b) => ({
    type: 'frame',
    id: `board${b}`,
    name: `Board ${b}`,
    x: b * 1600,
    y: 0,
    width: 1440,
    layout: 'vertical',
    gap: 16,
    fill: '#FFFFFF',
    children: Array.from({ length: 9 }, (_, c) => ({
      type: 'frame',
      id: `card${b}x${c}`,
      name: `Card ${c}`,
      layout: 'horizontal',
      gap: 8,
      padding: 12,
      children: [
        { type: 'text', id: `t${b}x${c}`, content: `Card ${c}`, fill: '#111111', fontSize: 16 },
        ...Array.from({ length: 9 }, (_, r) => ({
          type: 'rectangle',
          id: `r${b}x${c}x${r}`,
          width: 24,
          height: 24,
          fill: '#3366FF',
        })),
      ],
    })),
  }));
  return JSON.stringify({ version: '2.21', children: boards }, null, 2);
}

async function time(
  session: DocumentSession,
  input: string,
): Promise<{ ms: number; prints: string[] }> {
  const started = performance.now();
  const result = await session.execute({ input });
  const ms = performance.now() - started;
  if (!result.ok) throw new Error(`${result.error?.name}: ${result.error?.message}\n${input}`);
  return { ms, prints: result.prints };
}

async function bench(label: string, file: string) {
  const engine = await createEngine();
  const exec = createExecutor({ engine });
  let started = performance.now();
  const session = await exec.open(file);
  const open = performance.now() - started;
  const firstRoot = session.doc.children[0]?.id as string;

  const countAll = 'Print(Get((n) => 1).length)';
  const cold = await time(session, countAll);
  const warm: number[] = [];
  for (let i = 0; i < ROUNDS; i++) warm.push((await time(session, countAll)).ms);

  const boundsSnippet = `Print(Get(${JSON.stringify(firstRoot)}, (n, ctx) => ctx.bounds && ctx.bounds.width).length)`;
  const boundsCold = await time(session, boundsSnippet);
  const boundsWarm: number[] = [];
  for (let i = 0; i < ROUNDS; i++) boundsWarm.push((await time(session, boundsSnippet)).ms);

  const edit: number[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    edit.push(
      (
        await time(
          session,
          `const f = Insert(${JSON.stringify(firstRoot)}, {type: "frame", name: "Bench ${i}", width: 100, height: 40, fill: "#EEEEEE"}); Update(f, {width: 120})`,
        )
      ).ms,
    );
  }

  started = performance.now();
  const shot = await session.execute({ input: `TakeScreenshot([${JSON.stringify(firstRoot)}])` });
  const screenshot = performance.now() - started;
  if (!shot.ok) throw new Error(shot.error?.message);

  return {
    label,
    nodes: cold.prints[0],
    open,
    cold: cold.ms,
    warm: median(warm),
    boundsCold: boundsCold.ms,
    boundsWarm: median(boundsWarm),
    edit: median(edit),
    screenshot,
  };
}

const files: [string, string][] = [];
const synth = join(dir, 'synthetic.pen');
writeFileSync(synth, synthetic());
files.push(['synthetic, 1000 nodes', synth]);
for (const original of process.argv.slice(2)) {
  const copy = join(dir, basename(original));
  copyFileSync(original, copy);
  files.push([basename(original), copy]);
}

const rows = [];
for (const [label, file] of files) rows.push(await bench(label, file));

const ms = (value: number) => `${Math.round(value)}`;
console.log(
  '| File | Nodes | Open | Get visitor, cold | Get visitor, warm | Visitor with bounds on the first root, cold / warm | Insert + Update + write | Screenshot of the first root |',
);
console.log('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(
    `| ${r.label} | ${r.nodes} | ${ms(r.open)} | ${ms(r.cold)} | ${ms(r.warm)} | ${ms(r.boundsCold)} / ${ms(r.boundsWarm)} | ${ms(r.edit)} | ${ms(r.screenshot)} |`,
  );
}
