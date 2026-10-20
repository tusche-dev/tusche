/**
 * Contact sheet for blind human review (ADR-010).
 *
 *   bun evals/src/sheet.ts evals/runs/<label> [more labels…] [--seed n]
 *
 * Takes the renders of the screen tasks of one or more labels, shuffles them under
 * anonymous codes and writes `review/` next to the first label:
 *   index.html   — the images by code, nothing that names the task, style or skill version;
 *   ratings.csv  — code, reviewer_1, reviewer_2 (taste 1-5), to fill in;
 *   key.json     — code → label and task; do not open it before rating.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Score } from './score.ts';

interface Entry {
  code: string;
  label: string;
  task: string;
  images: string[];
}

/** Deterministic shuffle (mulberry32), so a sheet can be rebuilt with the same codes. */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { seed: { type: 'string' } },
  });
  if (positionals.length === 0) {
    console.error('usage: sheet.ts <label-dir> [more label dirs…] [--seed n]');
    process.exit(2);
  }
  const found: Omit<Entry, 'code'>[] = [];
  for (const labelDir of positionals.map((p) => resolve(p))) {
    for (const task of readdirSync(labelDir).sort()) {
      const scoreFile = join(labelDir, task, 'score.json');
      if (!existsSync(scoreFile)) continue;
      const score = JSON.parse(readFileSync(scoreFile, 'utf8')) as Score;
      if (score.kind !== 'screen' || score.renders.length === 0) continue;
      found.push({
        label: labelDir,
        task: score.task,
        images: score.renders.map((r) => join(labelDir, task, r)),
      });
    }
  }
  const seed = Number(values.seed ?? Date.now() % 100000);
  const entries: Entry[] = shuffle(found, seed).map((e, i) => ({
    ...e,
    code: String.fromCharCode(65 + (i % 26)) + String(Math.floor(i / 26) + 1),
  }));
  const out = join(resolve(positionals[0] as string), 'review');
  mkdirSync(join(out, 'img'), { recursive: true });
  const figures: string[] = [];
  for (const entry of entries) {
    const shots = entry.images.map((image, i) => {
      const name = `${entry.code}-${i + 1}.png`;
      copyFileSync(image, join(out, 'img', name));
      return `<img src="img/${name}" alt="${entry.code} image ${i + 1}" loading="lazy">`;
    });
    figures.push(
      `<section><h2>${entry.code}</h2><div class="shots">${shots.join('')}</div></section>`,
    );
  }
  writeFileSync(
    join(out, 'index.html'),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blind review</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1600px;padding:24px;background:#f4f4f2;color:#1a1a1a}
section{margin:0 0 48px}h2{font-size:20px;margin:0 0 12px}
.shots{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
img{max-width:100%;max-height:900px;background:#fff;box-shadow:0 0 0 1px #ddd}
</style></head><body>
<h1>Blind review</h1>
<p>Rate the taste of each design from 1 (generic, broken) to 5 (would ship) in ratings.csv. Judge hierarchy, spacing, type, colour and whether it looks generated. Do not open key.json before you finish.</p>
${figures.join('\n')}
</body></html>
`,
  );
  writeFileSync(
    join(out, 'ratings.csv'),
    `code,reviewer_1,reviewer_2\n${entries.map((e) => `${e.code},,`).join('\n')}\n`,
  );
  writeFileSync(
    join(out, 'key.json'),
    `${JSON.stringify(
      { seed, entries: entries.map(({ code, label, task }) => ({ code, label, task })) },
      null,
      2,
    )}\n`,
  );
  console.log(`${entries.length} designs → ${join(out, 'index.html')}`);
}
