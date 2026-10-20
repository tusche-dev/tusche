import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Diagnostic } from '../src/index.ts';

export const fixturePath = (relative: string): string =>
  fileURLToPath(new URL(`../../../fixtures/${relative}`, import.meta.url));

export const readFixture = (relative: string): string =>
  readFileSync(fixturePath(relative), 'utf8');

export const codes = (diagnostics: readonly Diagnostic[], level?: Diagnostic['level']): string[] =>
  diagnostics.filter((d) => level === undefined || d.level === level).map((d) => d.code);
