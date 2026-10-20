/**
 * Checks that every archetype font covers Latin and Cyrillic (stage 1.6).
 *
 *   bun packages/styles/scripts/check-fonts.ts
 *
 * Inserts a Latin + Cyrillic sample in every font of every archetype and fails on
 * `missing-glyphs` or `unknown-font`. Needs the network or a warm font cache, so it is a
 * script rather than a test.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutor } from '@tusche/exec';
import { archetypes } from '../src/index.ts';

const SAMPLE = 'Aa Bb Qq 0123 Привет, Ёлка — «тест» № 5';
/** Display fonts may have a single weight (Dela Gothic One); body and mono need a bold. */
const WEIGHTS: Record<string, string[]> = {
  display: ['400'],
  body: ['400', '700'],
  mono: ['400', '700'],
};

const dir = mkdtempSync(join(tmpdir(), 'tusche-fonts-'));
const executor = createExecutor({ save: 'immediate' });
const session = await executor.open(join(dir, 'fonts.pen'), { create: true });

let failed = 0;
for (const [name, archetype] of await archetypes()) {
  const roles = Object.entries(archetype.fonts).filter(([, family]) => family !== undefined);
  const texts = roles.flatMap(([role, family]) =>
    (WEIGHTS[role] ?? ['400']).map(
      (weight) =>
        `{type: "text", name: "${role} ${weight}", content: ${JSON.stringify(SAMPLE)}, fontFamily: ${JSON.stringify(family)}, fontWeight: "${weight}", fill: "#000000"}`,
    ),
  );
  const result = await session.execute({
    input: `Insert(document, {type: "frame", name: ${JSON.stringify(name)}, layout: "vertical", children: [${texts.join(', ')}]})`,
  });
  const problems = result.ok
    ? result.warnings.filter((w) => w.code === 'missing-glyphs' || w.code === 'unknown-font')
    : [{ code: 'error', message: result.error?.message ?? 'failed' }];
  const fonts = roles.map(([role, family]) => `${role}: ${family}`).join(', ');
  if (problems.length === 0) {
    console.log(`ok    ${name} (${fonts})`);
  } else {
    failed++;
    console.log(`FAIL  ${name} (${fonts})`);
    for (const p of problems) console.log(`      [${p.code}] ${p.message}`);
  }
}
await session.close();
if (failed > 0) {
  console.log(`${failed} archetype(s) with font problems`);
  process.exit(1);
}
