import { describe, expect, test } from 'bun:test';
import { listSkillFiles, readSkill, SkillNotFoundError } from '../src/index.ts';

describe('skill', () => {
  test('SKILL.md by default, with front matter', async () => {
    const text = await readSkill();
    expect(text).toStartWith('---\nname: tusche\n');
    expect(await readSkill('./SKILL.md')).toBe(text);
  });

  test('every file SKILL.md links to exists', async () => {
    const files = await listSkillFiles();
    expect(files).toEqual(['SKILL.md', 'execute.md', 'pen-format.md']);
    const links = [...(await readSkill()).matchAll(/\]\(([^)]+\.md)\)/g)].map((m) => m[1]);
    for (const link of links) expect(files).toContain(link as string);
  });

  test('unknown files and paths outside the folder are not found', async () => {
    for (const path of ['nope.md', '../package.json', '../../README.md', 'C:/Windows/win.ini']) {
      const error = await readSkill(path).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SkillNotFoundError);
      expect((error as Error).message).toContain('available: SKILL.md, execute.md');
    }
  });
});
