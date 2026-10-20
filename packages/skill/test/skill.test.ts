import { describe, expect, test } from 'bun:test';
import { posix } from 'node:path';
import { listSkillFiles, readSkill, SkillNotFoundError } from '../src/index.ts';

describe('skill', () => {
  test('SKILL.md by default, with front matter', async () => {
    const text = await readSkill();
    expect(text).toStartWith('---\nname: tusche\n');
    expect(await readSkill('./SKILL.md')).toBe(text);
  });

  test('version 0.1.1, at most 250 lines', async () => {
    const text = await readSkill();
    expect(text).toContain('\nversion: 0.1.1\n');
    expect(text.split('\n').length).toBeLessThanOrEqual(250);
  });

  test('every file is linked from SKILL.md and every link resolves', async () => {
    const files = await listSkillFiles();
    expect(files).toEqual([
      'SKILL.md',
      'execute.md',
      'guide/code.md',
      'guide/design-system.md',
      'guide/landing-page.md',
      'guide/mobile-app.md',
      'guide/slides.md',
      'guide/tailwind.md',
      'guide/web-app.md',
      'pen-format.md',
    ]);
    const linked = new Set<string>();
    for (const file of files) {
      const base = posix.dirname(file);
      for (const [, link] of (await readSkill(file)).matchAll(/\]\(([^)#]+\.md)\)/g)) {
        const target = posix.normalize(posix.join(base, link as string));
        expect({ file, target, exists: files.includes(target) }).toEqual({
          file,
          target,
          exists: true,
        });
        if (file === 'SKILL.md') linked.add(target);
      }
    }
    expect(files.filter((f) => f !== 'SKILL.md' && !linked.has(f))).toEqual([]);
  });

  test('unknown files and paths outside the folder are not found', async () => {
    for (const path of ['nope.md', '../package.json', '../../README.md', 'C:/Windows/win.ini']) {
      const error = await readSkill(path).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SkillNotFoundError);
      expect((error as Error).message).toContain('available: SKILL.md, execute.md');
    }
  });
});
