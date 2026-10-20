import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Folder with `SKILL.md` and the guides it links to. */
export const SKILL_DIR = fileURLToPath(new URL('../content', import.meta.url));

/** Paths of every skill file, relative to the skill folder, `/`-separated, sorted. */
export async function listSkillFiles(): Promise<string[]> {
  const entries = await readdir(SKILL_DIR, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => relative(SKILL_DIR, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

export class SkillNotFoundError extends Error {
  constructor(
    readonly path: string,
    readonly available: string[],
  ) {
    super(`no skill file "${path}"; available: ${available.join(', ')}`);
    this.name = 'SkillNotFoundError';
  }
}

/**
 * Text of `SKILL.md`, or of a file it links to (`execute.md`, `guide/web-app.md`, …).
 * Paths that leave the skill folder are not found.
 */
export async function readSkill(path = 'SKILL.md'): Promise<string> {
  const name = path.replace(/^\.?\//, '');
  const file = resolve(SKILL_DIR, name);
  const inside = relative(SKILL_DIR, file);
  if (name.endsWith('.md') && inside !== '' && !inside.startsWith('..') && !inside.includes(':')) {
    try {
      return await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new SkillNotFoundError(path, await listSkillFiles());
}
