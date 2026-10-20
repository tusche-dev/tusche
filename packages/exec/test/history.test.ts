import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine, type Engine } from '@tusche/engine';
import { type ChangeEvent, ConflictError, createExecutor, type Executor } from '../src/index.ts';

let engine: Engine;
let exec: Executor;
let delayed: Executor;
const dir = mkdtempSync(join(tmpdir(), 'tusche-history-'));

beforeAll(async () => {
  engine = await createEngine({ allowNetwork: false, cacheDir: join(dir, 'cache') });
  exec = createExecutor({ engine });
  delayed = createExecutor({ engine, save: { delayMs: 30 } });
});

let n = 0;
const EMPTY = '{\n  "version": "2.21",\n  "children": []\n}';
const file = (text = EMPTY) => {
  const path = join(dir, `doc${n++}.pen`);
  writeFileSync(path, text);
  return path;
};
const names = (path: string) =>
  (JSON.parse(readFileSync(path, 'utf8')).children as { name: string }[]).map((c) => c.name);
const insert = (name: string) =>
  `Insert(document, {type: "frame", name: "${name}", width: 10, height: 10})`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('undo and redo', () => {
  test('step through commits with the document, the globals and the file', async () => {
    const path = file();
    const session = await exec.open(path);
    await session.execute({ input: `count = 1\n${insert('A')}` });
    await session.execute({ input: `count = 2\n${insert('B')}` });
    // A call that changes nothing is not a step.
    await session.execute({ input: 'Print(count)' });
    expect(session.undoDepth).toBe(2);

    const undone = await session.undo();
    expect(undone).toMatchObject({ steps: 1, undo: 1, redo: 1, warnings: [] });
    expect(session.doc.children.map((c) => c.name)).toEqual(['A']);
    expect(names(path)).toEqual(['A']);
    expect((await session.execute({ input: 'Print(count)' })).prints).toEqual(['1']);

    expect(await session.redo()).toMatchObject({ steps: 1, undo: 2, redo: 0 });
    expect(names(path)).toEqual(['A', 'B']);
    expect((await session.execute({ input: 'Print(count)' })).prints).toEqual(['2']);

    // More steps than there are: only what exists.
    expect(await session.undo(5)).toMatchObject({ steps: 2, undo: 0, redo: 2 });
    expect(names(path)).toEqual([]);
    expect(await session.undo()).toMatchObject({ steps: 0, undo: 0, redo: 2 });
  });

  test('a new commit clears redo; the scene follows the undone document', async () => {
    const path = file();
    const session = await exec.open(path);
    const first = await session.execute({ input: insert('A') });
    await session.execute({ input: insert('B') });
    await session.undo();
    await session.execute({ input: insert('C') });
    expect(session.redoDepth).toBe(0);
    expect(names(path)).toEqual(['A', 'C']);

    const id = first.names[0]?.[1] as string;
    await session.undo(2);
    const shot = await session.execute({ input: `TakeScreenshot([${JSON.stringify(id)}])` });
    expect(shot).toMatchObject({ ok: false, error: { message: expect.stringMatching(id) } });
  });

  test('a failed call is not a step and keeps its editId', async () => {
    const session = await exec.open(file());
    await session.execute({ input: insert('A') });
    const failed = await session.execute({ input: `${insert('B')}\nthrow new Error("x")` });
    expect(session.undoDepth).toBe(1);
    await session.undo();
    const fixed = await session.execute({
      editId: failed.editId as string,
      edits: [{ find: '\nthrow new Error("x")', replace: '' }],
    });
    expect(fixed.ok).toBe(true);
    expect(session.doc.children.map((c) => c.name)).toEqual(['B']);
  });
});

describe('delayed save', () => {
  test('writes once after the last change; flush writes now', async () => {
    const path = file();
    const session = await delayed.open(path);
    const result = await session.execute({ input: insert('A') });
    expect(result.saved).toBe(false);
    expect(session.dirty).toBe(true);
    expect(names(path)).toEqual([]);

    await sleep(80);
    expect(session.dirty).toBe(false);
    expect(names(path)).toEqual(['A']);

    await session.execute({ input: insert('B') });
    await session.flush();
    expect(session.dirty).toBe(false);
    expect(names(path)).toEqual(['A', 'B']);
  });

  test('flushAll and close write pending changes', async () => {
    const a = file();
    const b = file();
    const sa = await delayed.open(a);
    const sb = await delayed.open(b);
    await sa.execute({ input: insert('A') });
    await sb.execute({ input: insert('B') });
    expect(delayed.sessions()).toContain(sa);
    expect(await delayed.flushAll()).toEqual([]);
    expect(names(a)).toEqual(['A']);

    await sb.execute({ input: insert('C') });
    await delayed.close(b);
    expect(names(b)).toEqual(['B', 'C']);
    expect(delayed.session(b)).toBeUndefined();
    expect(await delayed.open(b)).not.toBe(sb);
  });
});

describe('changes on disk', () => {
  test('nothing unsaved: the file is read again, globals stay, undo is cleared', async () => {
    const path = file();
    const session = await exec.open(path);
    const events: ChangeEvent['kind'][] = [];
    session.onChange((event) => events.push(event.kind));
    await session.execute({ input: `kept = 7\n${insert('A')}` });
    expect(await session.checkDisk()).toBe('same');

    writeFileSync(
      path,
      '{\n  "version": "2.21",\n  "children": [{"type": "frame", "id": "ext01", "name": "Ext"}]\n}',
    );
    expect(await session.checkDisk()).toBe('reloaded');
    expect(session.doc.children.map((c) => c.name)).toEqual(['Ext']);
    expect(session.undoDepth).toBe(0);
    expect((await session.execute({ input: 'Print(kept, Get("ext01").name)' })).prints).toEqual([
      '7 Ext',
    ]);
    expect(events).toEqual(['commit', 'reload']);
  });

  test('unsaved changes: a conflict; force writes over the file, reload takes it', async () => {
    const path = file();
    const session = await delayed.open(path);
    await session.execute({ input: insert('Mine') });
    writeFileSync(
      path,
      EMPTY.replace('[]', '[{"type": "frame", "id": "ext01", "name": "Theirs"}]'),
    );
    expect(await session.checkDisk()).toBe('conflict');
    expect(session.conflict).toBe(true);
    await expect(session.flush()).rejects.toBeInstanceOf(ConflictError);
    await sleep(80);
    expect(names(path)).toEqual(['Theirs']);

    await session.flush({ force: true });
    expect(session.conflict).toBe(false);
    expect(names(path)).toEqual(['Mine']);

    await session.execute({ input: insert('Again') });
    writeFileSync(path, EMPTY);
    expect(await session.checkDisk()).toBe('conflict');
    await session.reload();
    expect(session.conflict).toBe(false);
    expect(session.dirty).toBe(false);
    expect(session.doc.children).toEqual([]);
  });

  test('a deleted file', async () => {
    const path = file();
    const session = await exec.open(path);
    rmSync(path);
    expect(await session.checkDisk()).toBe('deleted');
  });
});
