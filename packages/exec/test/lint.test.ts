import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine } from '@tusche/engine';
import {
  createExecutor,
  type Executor,
  formatLint,
  lintCounts,
  lintDocument,
} from '../src/index.ts';

let exec: Executor;
const dir = mkdtempSync(join(tmpdir(), 'tusche-lint-'));

beforeAll(async () => {
  exec = createExecutor({
    engine: await createEngine({ allowNetwork: false, cacheDir: join(dir, 'cache') }),
  });
});

let n = 0;
const open = (doc: unknown) => {
  const path = join(dir, `doc${n++}.pen`);
  writeFileSync(path, JSON.stringify(doc, null, 2));
  return exec.open(path);
};

const DOC = {
  version: '2.21',
  children: [
    {
      type: 'frame',
      id: 'card',
      width: 200,
      height: 60,
      clip: true,
      layout: 'vertical',
      fill: '#FFFFFF',
      children: [
        { type: 'text', id: 'pale', content: 'Pale', fill: '#F5F5F5', fontSize: 16 },
        { type: 'text', id: 'ghost', content: 'No fill', fontSize: 16 },
        { type: 'rectangle', id: 'tall', width: 20, height: 300, fill: '#000000' },
      ],
    },
    { type: 'frame', id: 'clean', width: 40, height: 40, fill: '#000000' },
  ],
};

describe('lintDocument', () => {
  test('every node: execute checks, validator warnings, OpenPencil rules', async () => {
    const issues = await lintDocument(await open(DOC));
    const codes = issues.map((i) => `${i.level} ${i.code} ${i.path}`);
    expect(codes).toContain('error op/color-contrast pale');
    expect(codes).toContain('warning invisible-text ghost');
    expect(codes).toContain('warning clipped tall');
    // Errors first; no style suggestions without `info`.
    expect(issues[0]?.level).toBe('error');
    expect(issues.some((i) => i.level === 'info')).toBe(false);
    expect(lintCounts(issues).error).toBeGreaterThan(0);

    const text = formatLint(issues);
    expect(text).toMatch(/^lint · \d+ errors? · \d+ warnings?\n/);
    expect(text).toContain('  error [op/color-contrast] pale: ');
  });

  test('one subtree; info on request; unknown path throws', async () => {
    const session = await open(DOC);
    const only = await lintDocument(session, { path: 'clean' });
    expect(only.every((i) => i.path === 'clean')).toBe(true);
    const all = await lintDocument(session, { info: true });
    expect(all.some((i) => i.level === 'info')).toBe(true);
    await expect(lintDocument(session, { path: 'nope' })).rejects.toThrow('no node at "nope"');
  });

  test('schema errors are reported with their path', async () => {
    const issues = await lintDocument(
      await open({ version: '2.21', children: [{ type: 'frame', id: 'f', width: 'wide' }] }),
    );
    expect(issues[0]).toMatchObject({ level: 'error', code: 'schema' });
  });
});
