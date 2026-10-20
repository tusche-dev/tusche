// Renders the top-level nodes of .pen files, times the engine and compares the PNGs
// with a baseline.
//
//   bun packages/engine/scripts/render-baseline.ts <file.pen>... [options]
//
//   --out <dir>        where renders go (default: .tusche/renders/<file name>)
//   --baseline <dir>   baseline PNGs (default: <dir of file>/baseline for fixtures,
//                      otherwise <out>/baseline)
//   --update           write the renders as the new baseline
//   --roots a,b        only these top-level nodes
//   --scale <n>        pixel ratio (default 1)
//   --max-ratio <r>    allowed share of changed pixels (default 0.001)
//   --offline          do not download fonts or icons
//
// Exit code 1 when a render differs from its baseline more than allowed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { migratePen, parsePen } from '@tusche/pen-format';
import { createEngine } from '../src/index.ts';

const args = process.argv.slice(2);
const files: string[] = [];
const options: Record<string, string | true> = {};
for (let i = 0; i < args.length; i++) {
  const arg = args[i] as string;
  if (arg.startsWith('--')) {
    const next = args[i + 1];
    if (['--update', '--offline'].includes(arg) || next === undefined || next.startsWith('--')) {
      options[arg.slice(2)] = true;
    } else {
      options[arg.slice(2)] = next;
      i++;
    }
  } else files.push(arg);
}
if (files.length === 0) {
  console.error('usage: render-baseline.ts <file.pen>... [--update] [--out dir] [--baseline dir]');
  process.exit(2);
}

const repo = resolve(import.meta.dir, '../../..');
const scale = Number(options.scale ?? 1);
const maxRatio = Number(options['max-ratio'] ?? 0.001);
const onlyRoots = typeof options.roots === 'string' ? new Set(options.roots.split(',')) : undefined;
const ms = (value: number) => `${Math.round(value)}`;

const processStart = performance.now();
const engineStart = performance.now();
const engine = await createEngine({ allowNetwork: options.offline !== true });
const engineMs = performance.now() - engineStart;
console.log(`engine: ${ms(engineMs)} ms (CanvasKit + bundled fonts)`);

let failed = false;
const summary: string[] = [];

for (const file of files.map((f) => resolve(f))) {
  const name = basename(file, '.pen');
  const insideRepo = !relative(repo, file).startsWith('..');
  const out = resolve(
    typeof options.out === 'string' ? options.out : join(repo, '.tusche', 'renders', name),
  );
  const baselineDir = resolve(
    typeof options.baseline === 'string'
      ? options.baseline
      : insideRepo
        ? join(dirname(file), 'baseline')
        : join(out, 'baseline'),
  );
  mkdirSync(out, { recursive: true });

  const t0 = performance.now();
  const { doc } = parsePen(readFileSync(file, 'utf8'));
  const migration = migratePen(doc);
  const scene = await engine.open(doc, { baseDir: dirname(file) });
  const openMs = performance.now() - t0;
  const roots = scene.projection.topLevelIds.filter((id) => !onlyRoots || onlyRoots.has(id));
  console.log(
    `\n${relative(process.cwd(), file)} — ${roots.length} top-level nodes, open ${ms(openMs)} ms` +
      (migration.applied.length ? `, migrations: ${migration.applied.join(', ')}` : ''),
  );

  let first: number | undefined;
  let worst = 0;
  let layoutTotal = 0;
  let warmTotal = 0;
  let missingFonts = new Set<string>();
  for (const id of roots) {
    const layout = await scene.layout([id]);
    layoutTotal += layout.ms;
    for (const font of layout.missingFonts) missingFonts.add(font);
    const r0 = performance.now();
    const png = await scene.render([id], { scale });
    const coldMs = performance.now() - r0;
    first ??= performance.now() - processStart;
    const r1 = performance.now();
    await scene.render([id], { scale });
    const warmMs = performance.now() - r1;
    warmTotal += warmMs;
    if (!png) {
      console.log(`  ${id}: empty`);
      continue;
    }
    const fileName = `${id.replace(/[^\w-]/g, '_')}.png`;
    writeFileSync(join(out, fileName), png);
    let verdict = '';
    const basePath = join(baselineDir, fileName);
    if (options.update) {
      mkdirSync(baselineDir, { recursive: true });
      writeFileSync(basePath, png);
      verdict = 'baseline updated';
    } else if (existsSync(basePath)) {
      const comparison = engine.compare(readFileSync(basePath), png);
      worst = Math.max(worst, comparison.ratio);
      verdict = `diff ${(comparison.ratio * 100).toFixed(3)}%`;
      if (comparison.diff)
        writeFileSync(join(out, `${fileName.slice(0, -4)}.diff.png`), comparison.diff);
      if (comparison.ratio > maxRatio) {
        failed = true;
        verdict += ' ✗';
      }
    } else verdict = 'no baseline';
    const node = scene.projection.node(id);
    console.log(
      `  ${id} ${JSON.stringify(node?.name ?? '')} ${Math.round(node?.width ?? 0)}×${Math.round(node?.height ?? 0)}: ` +
        `layout ${ms(layout.ms)} (fonts ${ms(layout.timings.fonts)}), render ${ms(coldMs)}, warm ${ms(warmMs)} ms — ${verdict}`,
    );
  }
  const stats = scene.projection.stats;
  const codes = new Map<string, number>();
  for (const w of scene.warnings) codes.set(w.code, (codes.get(w.code) ?? 0) + 1);
  console.log(
    `  scene: ${stats.sceneNodes} nodes, ${stats.instances} instances, projection ${ms(stats.ms)} ms; ` +
      `warnings: ${[...codes].map(([c, n]) => `${c} ${n}`).join(', ') || 'none'}` +
      (missingFonts.size ? `; missing fonts: ${[...missingFonts].join(', ')}` : ''),
  );
  summary.push(
    `| ${name} | ${roots.length} | ${stats.sceneNodes} | ${ms(stats.ms)} | ${ms(first ?? 0)} | ${ms(layoutTotal)} | ${ms(warmTotal / Math.max(roots.length, 1))} | ${(worst * 100).toFixed(3)}% |`,
  );
  missingFonts = new Set();
}

console.log(
  '\n| File | Roots | Scene nodes | Projection, ms | First PNG from start, ms | Layout total, ms | Warm render avg, ms | Worst diff |',
);
console.log('|---|---|---|---|---|---|---|---|');
for (const row of summary) console.log(row);
process.exit(failed ? 1 : 0);
