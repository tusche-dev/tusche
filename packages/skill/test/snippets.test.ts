import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutor } from '@tusche/exec';
import { listSkillFiles, readSkill } from '../src/index.ts';

/** Font warnings depend on the network and the font cache, not on the guide. */
const IGNORED = new Set(['unknown-font', 'missing-glyphs', 'empty-screenshot']);

const guides = (await listSkillFiles()).filter((f) => f.startsWith('guide/'));
const dir = mkdtempSync(join(tmpdir(), 'tusche-skill-'));
const executor = createExecutor({ save: 'immediate' });

describe('guide snippets run without errors or warnings', () => {
  for (const guide of guides) {
    test(guide, async () => {
      const text = await readSkill(guide);
      const blocks = [...text.matchAll(/```js\n([\s\S]*?)```/g)].map((m) => m[1] as string);
      const session = await executor.open(join(dir, `${guide.replace(/\W/g, '-')}.pen`), {
        create: true,
      });
      for (const [i, input] of blocks.entries()) {
        const result = await session.execute({ input });
        const problems = [
          ...(result.ok ? [] : [`error: ${result.error?.message}`]),
          ...result.warnings
            .filter((w) => !IGNORED.has(w.code))
            .map((w) => `[${w.code}] ${w.message}`),
        ];
        expect({ block: i + 1, problems }).toEqual({ block: i + 1, problems: [] });
      }
      await session.close();
    }, 60_000);
  }
});
