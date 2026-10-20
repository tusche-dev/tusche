import { describe, expect, test } from 'bun:test';
import { ExecError } from '../src/errors.ts';
import { type HostOp, type RunOptions, runSnippet } from '../src/sandbox.ts';

const prints: string[][] = [];
const ops: Record<string, HostOp> = {
  Print: ([values]) => {
    prints.push(values as string[]);
  },
  Insert: ([parent, node]) => {
    if (parent !== 'document') {
      throw new ExecError(`Insert(): no node "${parent}"`, { hint: 'check the id' });
    }
    return `id-${(node as { name?: string }).name ?? 'x'}`;
  },
  FindEmptySpace: async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { x: 1, y: 2 };
  },
};

const run = (code: string, extra: Partial<RunOptions> = {}) => runSnippet({ code, ops, ...extra });
const lastPrint = () => prints.at(-1);

describe('host calls', () => {
  test('API calls reach the host with JSON arguments and return its values', async () => {
    const result = await run(
      `const id = Insert(document, { type: 'frame', name: 'Hero' }); Print(id, 1, { a: [1] })`,
    );
    expect(result.ok).toBe(true);
    expect(lastPrint()).toEqual(['id-Hero', '1', '{"a":[1]}']);
  });

  test('a host function may be async: the snippet stays synchronous', async () => {
    const result = await run('const p = FindEmptySpace({}); Print(p.x + p.y)');
    expect(result.ok).toBe(true);
    expect(lastPrint()).toEqual(['3']);
  });

  test('host errors become exceptions with a line and a hint', async () => {
    const result = await run(`Print('a')\n\nInsert('nope', {})`);
    expect(result).toMatchObject({
      ok: false,
      error: { name: 'Error', message: 'Insert(): no node "nope"', line: 3, hint: 'check the id' },
    });
  });

  test('an exception can be caught by the snippet', async () => {
    const result = await run(`try { Insert('nope', {}) } catch (e) { Print(e.message, e.hint) }`);
    expect(result.ok).toBe(true);
    expect(lastPrint()).toEqual(['Insert(): no node "nope"', 'check the id']);
  });

  test('non-JSON arguments are rejected', async () => {
    const result = await run('Insert(document, { type: "frame", onClick() {} })');
    expect(result).toMatchObject({ ok: false, error: { name: 'TypeError' } });
    if (result.ok) throw new Error('unreachable');
    expect(result.error.message).toContain('"onClick" is a function');
    expect(await run('Insert(document, { width: NaN })')).toMatchObject({
      ok: false,
      error: { name: 'TypeError' },
    });
  });

  test('a function the host does not provide is an internal error', async () => {
    const result = await runSnippet({ code: 'Delete("x")', ops: {} });
    expect(result).toMatchObject({ ok: false, error: { name: 'InternalError' } });
  });
});

describe('errors of the snippet itself', () => {
  test('syntax and reference errors point at their line', async () => {
    expect(await run('const a = 1\nconst b = (')).toMatchObject({
      ok: false,
      error: { name: 'SyntaxError', line: 2 },
    });
    expect(await run('\n\nnotDefined + 1')).toMatchObject({
      ok: false,
      error: { name: 'ReferenceError', line: 3 },
    });
  });

  test('a thrown non-error value is reported', async () => {
    expect(await run('throw "plain"')).toMatchObject({ ok: false, error: { message: 'plain' } });
  });

  test('deep recursion is a RangeError, not a crash', async () => {
    const result = await run('const f = (n) => f(n + 1) + 1; f(0)');
    expect(result).toMatchObject({ ok: false, error: { name: 'RangeError' } });
  });
});

describe('global variables', () => {
  test('plain assignments persist as JSON; const, let, var and functions do not', async () => {
    const first = await run(
      'heroId = "abc"; counter = 1; const local = 2; var v = 3; fn = () => 1; big = { list: [1, 2] }',
    );
    if (!first.ok) throw new Error(first.error.message);
    expect(first.globals).toEqual({ heroId: '"abc"', counter: '1', big: '{"list":[1,2]}' });
    expect(first.dropped).toEqual(['fn']);
    const second = await run(
      'counter = counter + 1; Print(heroId, counter, big.list.length, typeof local, typeof v)',
      { globals: first.globals },
    );
    expect(second).toMatchObject({ ok: true, globals: { counter: '2' } });
    expect(lastPrint()).toEqual(['abc', '2', '2', 'undefined', 'undefined']);
  });

  test('deleting a global forgets it', async () => {
    const result = await run('delete heroId', { globals: { heroId: '"abc"', keep: '1' } });
    expect(result).toMatchObject({ ok: true, globals: { keep: '1' } });
    if (!result.ok) throw new Error('unreachable');
    expect(Object.keys(result.globals)).toEqual(['keep']);
  });

  test('document and the API cannot be overwritten', async () => {
    const result = await run('document = "x"; Insert = null; Print(document, typeof Insert)');
    expect(result).toMatchObject({ ok: true, globals: {} });
    expect(lastPrint()).toEqual(['document', 'function']);
  });
});

describe('isolation and limits', () => {
  test('no fetch, require, process, Bun or the raw bridge', async () => {
    const result = await run(
      'Print(typeof fetch, typeof require, typeof process, typeof Bun, typeof XMLHttpRequest, typeof __host)',
    );
    expect(result.ok).toBe(true);
    expect(lastPrint()).toEqual(Array(6).fill('undefined'));
  });

  test('an endless loop is stopped by the time limit', async () => {
    const result = await run('while (true) {}', { limits: { timeMs: 200 } });
    expect(result).toMatchObject({ ok: false, error: { name: 'TimeoutError' } });
    expect(result.ms).toBeLessThan(2000);
  });

  test('time spent in the host counts: a call after the deadline fails', async () => {
    const slow: HostOp = () => new Promise((resolve) => setTimeout(() => resolve({ x: 0 }), 150));
    const result = await runSnippet({
      code: 'FindEmptySpace({}); FindEmptySpace({})',
      ops: { FindEmptySpace: slow },
      limits: { timeMs: 100 },
    });
    expect(result).toMatchObject({ ok: false, error: { name: 'TimeoutError' } });
  });

  test('running out of memory is reported, and the next call works', async () => {
    const result = await run('const a = []; while (true) a.push("x".repeat(1e5) + a.length)', {
      limits: { memoryBytes: 16 * 1024 * 1024 },
    });
    expect(result).toMatchObject({ ok: false, error: { name: 'MemoryError' } });
    expect((await run('Print("still alive")')).ok).toBe(true);
  });
});
