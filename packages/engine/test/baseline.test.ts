import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migratePen, parsePen } from '@tusche/pen-format';
import { createEngine } from '../src/index.ts';

// Reference renders of fixtures/pen/eval, reviewed by eye (see docs/dev/02-research.md).
// Fonts come from Google Fonts on the first run and then from the cache
// (TUSCHE_CACHE_DIR in CI). Without them text would be drawn with a fallback
// face, so the comparison is skipped instead of failing.
const file = fileURLToPath(new URL('../../../fixtures/pen/eval/design.pen', import.meta.url));
const baselineDir = join(dirname(file), 'baseline');
const MAX_RATIO = 0.001;

describe('reference renders: fixtures/pen/eval', async () => {
  const engine = await createEngine();
  const { doc } = parsePen(readFileSync(file, 'utf8'));
  migratePen(doc);
  const scene = await engine.open(doc, { baseDir: dirname(file) });
  const report = await scene.layout();
  const skip = !report.fontsFaithful;
  if (skip) console.warn(`skipped: fonts unavailable (${report.missingFonts.join(', ')})`);

  for (const id of scene.projection.topLevelIds) {
    test.skipIf(skip)(`${id} matches the baseline`, async () => {
      const baseline = join(baselineDir, `${id}.png`);
      expect(existsSync(baseline)).toBe(true);
      const png = await scene.render([id]);
      expect(png).toBeDefined();
      const comparison = engine.compare(readFileSync(baseline), png as Uint8Array);
      expect(comparison.ratio).toBeLessThanOrEqual(MAX_RATIO);
    });
  }

  test('only placeholders are reported (8 shader fills)', () => {
    expect(scene.warnings.map((w) => w.code)).toEqual(Array(8).fill('stub'));
  });
});
