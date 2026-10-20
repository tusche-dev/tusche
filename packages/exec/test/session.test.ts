import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine } from '@tusche/engine';
import { createExecutor, type Executor, formatResult } from '../src/index.ts';

let exec: Executor;
const dir = mkdtempSync(join(tmpdir(), 'tusche-session-'));

beforeAll(async () => {
  exec = createExecutor({
    engine: await createEngine({ allowNetwork: false, cacheDir: join(dir, 'cache') }),
  });
});

let n = 0;
const file = (text?: string) => {
  const path = join(dir, `doc${n++}.pen`);
  if (text !== undefined) writeFileSync(path, text);
  return path;
};

describe('DocumentSession', () => {
  test('creates a file, commits a call, writes it and answers in text', async () => {
    const path = file();
    const session = await exec.open(path, { create: true });
    const result = await session.execute({
      input: `hero = Insert(document, {type: "frame", name: "Hero", width: 400, height: 200, layout: "none", fill: "#FFFFFF"})
Insert(hero, {type: "text", name: "Title", content: "Hi", fill: "#000000"})
Print(hero)`,
    });
    expect(result).toMatchObject({ ok: true, saved: true, counts: { inserted: 2 } });
    const { text } = formatResult(result);
    expect(text).toMatch(
      /^ok · 2 inserted · 0 updated · 0 deleted · \d+ ms\nnames:\n {2}Hero=\w{5} {2}Title=\w{5}\nprint:\n {2}\w{5}$/,
    );
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    expect(saved.children[0]).toMatchObject({ name: 'Hero', children: [{ name: 'Title' }] });

    // Globals survive to the next call; a read-only call does not write.
    const before = readFileSync(path, 'utf8');
    const next = await session.execute({ input: 'Print(Get(hero).name)' });
    expect(next).toMatchObject({ ok: true, saved: false, prints: ['Hero'] });
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  test('a failed call rolls back; edits fix it under the same editId', async () => {
    const path = file('{\n    "version": "2.21",\n    "children": []\n}\n');
    const session = await exec.open(path);
    const failed = await session.execute({
      input:
        'Insert(document, {type: "frame", name: "A"})\nInsert(document, {type: "text", content: "x", padding: 12})',
    });
    expect(failed).toMatchObject({
      ok: false,
      editId: 'e1',
      error: { name: 'TypeError', line: 2 },
    });
    const { text } = formatResult(failed);
    expect(text.split('\n')[0]).toBe('error · rolled back · editId=e1');
    expect(text).toContain(
      'at line 2:  Insert(document, {type: "text", content: "x", padding: 12})',
    );
    expect(text).toContain('hint: wrap the node in a frame');
    expect(session.doc.children).toEqual([]);

    const notFound = await session.execute({
      editId: 'e1',
      edits: [{ find: 'nope', replace: '' }],
    });
    expect(notFound).toMatchObject({ ok: false, editId: 'e1', error: { name: 'EditError' } });
    expect(formatResult(notFound).text.split('\n')[0]).toBe('error · not run · editId=e1');

    const fixed = await session.execute({
      editId: 'e1',
      edits: [{ find: ', padding: 12', replace: ', fill: "#000000"' }],
    });
    expect(fixed).toMatchObject({ ok: true, counts: { inserted: 2 } });
    // The file keeps its style: four spaces and a final newline.
    expect(readFileSync(path, 'utf8')).toMatch(/^\{\n {4}"version": "2\.21",[\s\S]*\}\n$/);
    const gone = await session.execute({ editId: 'e1', edits: [{ find: 'a', replace: 'b' }] });
    expect(gone).toMatchObject({ ok: false, error: { name: 'EditError' } });
    expect(gone.editId).toBeUndefined();
  });

  test('warnings after the commit: ignored x/y, clipping', async () => {
    const session = await exec.open(file(), { create: true });
    const result = await session.execute({
      input: `const f = Insert(document, {type: "frame", name: "Box", width: 100, height: 100, clip: true, layout: "vertical"})
Insert(f, {type: "rectangle", name: "Big", x: 10, width: 50, height: 300})`,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w) => w.code).sort()).toEqual(['clipped', 'ignored-xy']);
    expect(formatResult(result).text).toContain('[clipped] "Big" (');
  });

  test('screenshots are rendered after the commit; none on failure', async () => {
    const session = await exec.open(file(), { create: true });
    const ok = await session.execute({
      input:
        'const f = Insert(document, {type: "frame", width: 40, height: 30, fill: "#FF0000"}); TakeScreenshot([f])',
    });
    expect(ok.screenshots).toHaveLength(1);
    expect(formatResult(ok).images[0]?.png.slice(1, 4)).toEqual(new TextEncoder().encode('PNG'));
    const failed = await session.execute({
      input: 'TakeScreenshot([document]); throw new Error("x")',
    });
    expect(failed.screenshots).toEqual([]);
  });
});
