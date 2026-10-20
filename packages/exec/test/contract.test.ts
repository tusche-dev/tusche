/**
 * Contract tests of `execute`: every API function through the public session, its success
 * and every error path. The coverage table is in the package README.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine, type Engine } from '@tusche/engine';
import { parsePen, serializePen } from '@tusche/pen-format';
import { createExecutor, type ExecLimits, type ExecResult, formatResult } from '../src/index.ts';

const FIXTURE = join(import.meta.dir, '../../../fixtures/pen/eval/design.pen');
const dir = mkdtempSync(join(tmpdir(), 'tusche-contract-'));
let engine: Engine;

beforeAll(async () => {
  engine = await createEngine({ allowNetwork: false, cacheDir: join(dir, 'cache') });
});

const SYNTHETIC = JSON.stringify(
  {
    version: '2.21',
    variables: { 'color.fg': { type: 'color', value: '#111111' } },
    children: [
      {
        type: 'frame',
        id: 'btn',
        name: 'Button',
        reusable: true,
        x: 0,
        y: 0,
        width: 120,
        height: 40,
        layout: 'horizontal',
        children: [
          { type: 'text', id: 'label', content: 'OK', fill: '$color.fg' },
          { type: 'frame', id: 'slot', width: 10, height: 10, layout: 'vertical' },
        ],
      },
      {
        type: 'frame',
        id: 'page',
        name: 'Page',
        x: 200,
        y: 0,
        width: 400,
        height: 300,
        layout: 'vertical',
        fill: '#FFFFFF',
        children: [
          {
            type: 'ref',
            id: 'b1',
            ref: 'btn',
            descendants: { label: { content: 'Save' }, slot: { type: 'rectangle', id: 'swap' } },
          },
          {
            type: 'frame',
            id: 'box',
            layout: 'vertical',
            children: [{ type: 'rectangle', id: 'r1', width: 10, height: 10 }],
          },
        ],
      },
    ],
  },
  null,
  2,
);

let n = 0;
async function open(text = SYNTHETIC, limits?: Partial<ExecLimits>) {
  const path = join(dir, `c${n++}.pen`);
  writeFileSync(path, text);
  const exec = createExecutor(limits ? { engine, limits } : { engine });
  return { path, session: await exec.open(path) };
}

async function run(code: string, limits?: Partial<ExecLimits>): Promise<ExecResult> {
  const { session } = await open(SYNTHETIC, limits);
  return session.execute({ input: code });
}

/** `[function, snippet, error name, part of the message]` */
type ErrorCase = [string, string, string, string];

const ERRORS: ErrorCase[] = [
  // Insert
  ['Insert', 'Insert("nope", {type: "frame"})', 'Error', 'no node "nope"'],
  ['Insert', 'Insert("page#1", {type: "frame"})', 'TypeError', 'not a node path'],
  ['Insert', 'Insert(42, {type: "frame"})', 'TypeError', 'must be a node id or path'],
  ['Insert', 'Insert("r1", {type: "frame"})', 'TypeError', 'only frames and groups'],
  ['Insert', 'Insert("b1", {type: "frame"})', 'TypeError', 'only frames and groups'],
  [
    'Insert',
    'Insert("box", {type: "text", content: "x", padding: 4})',
    'TypeError',
    'layout property',
  ],
  ['Insert', 'Insert("box", {type: "frame", width: "50%"})', 'TypeError', 'at width'],
  ['Insert', 'Insert("box", {name: "no type"})', 'TypeError', 'with a "type"'],
  ['Insert', 'Insert("box", "frame")', 'TypeError', 'with a "type"'],
  ['Insert', 'Insert("box", {type: "frame", children: [1]})', 'TypeError', 'with a "type"'],
  ['Insert', 'Insert("box", {type: "frame", width: NaN})', 'TypeError', 'numbers must be finite'],
  ['Insert', 'Insert("box", {type: "frame", onClick() {}})', 'TypeError', 'only JSON values'],
  // Copy
  ['Copy', 'Copy("nope", "page")', 'Error', 'no node "nope"'],
  ['Copy', 'Copy(document, "page")', 'TypeError', 'cannot be copied'],
  ['Copy', 'Copy("box", "nope")', 'Error', 'no node "nope"'],
  ['Copy', 'Copy("box", "page", {id: "x"})', 'TypeError', '"id" cannot be overridden'],
  ['Copy', 'Copy("box", "page", {type: "group"})', 'TypeError', '"type" cannot be overridden'],
  ['Copy', 'Copy("box", "page", {children: []})', 'TypeError', '"children" cannot be overridden'],
  ['Copy', 'Copy("box", "page", 5)', 'TypeError', 'overrides must be an object'],
  ['Copy', 'Copy("box", "page", {descendants: 5})', 'TypeError', 'descendants must be an object'],
  ['Copy', 'Copy("box", "page", {descendants: {zz: {}}})', 'Error', 'no descendant "zz"'],
  ['Copy', 'Copy("box", "page", {width: "huge"})', 'TypeError', 'at width'],
  // Update
  ['Update', 'Update("nope", {})', 'Error', 'no node "nope"'],
  ['Update', 'Update(document, {})', 'TypeError', 'no properties to update'],
  ['Update', 'Update("page", {id: "x"})', 'TypeError', '"id" cannot be changed'],
  ['Update', 'Update("page", {type: "group"})', 'TypeError', '"type" cannot be changed'],
  ['Update', 'Update("b1", {ref: "page"})', 'TypeError', '"ref" cannot be changed'],
  ['Update', 'Update("page", {children: 5})', 'TypeError', 'children must be a list'],
  ['Insert', 'Insert("b1/label", {type: "frame"})', 'TypeError', 'only frames and groups'],
  ['Update', 'Update("page", "wide")', 'TypeError', 'props must be an object'],
  ['Update', 'Update("page", {width: "huge"})', 'TypeError', 'at width'],
  ['Update', 'Update("b1/label", {fontSize: "big"})', 'TypeError', 'Update()'],
  ['Update', 'Update("b1/nope", {width: 1})', 'Error', 'no node "b1/nope"'],
  // Replace
  ['Replace', 'Replace("nope", {type: "frame"})', 'Error', 'no node "nope"'],
  ['Replace', 'Replace(document, {type: "frame"})', 'TypeError', 'cannot be replaced'],
  ['Replace', 'Replace("r1", {width: 1})', 'TypeError', 'with a "type"'],
  ['Replace', 'Replace("r1", {type: "frame", width: "huge"})', 'TypeError', 'at width'],
  // Move
  ['Move', 'Move("nope", "page")', 'Error', 'no node "nope"'],
  ['Move', 'Move(document, "page")', 'TypeError', 'cannot be moved'],
  ['Move', 'Move("page", "page")', 'TypeError', 'into itself'],
  ['Move', 'Move("page", "box")', 'TypeError', 'into itself or its own descendant'],
  ['Move', 'Move("b1/label", "page")', 'Error', 'inside an instance'],
  ['Move', 'Move("r1", "b1/label")', 'Error', 'into an instance'],
  ['Move', 'Move("r1", "page", -1)', 'TypeError', 'whole number'],
  ['Move', 'Move("r1", "page", 1.5)', 'TypeError', 'whole number'],
  ['Move', 'Move("r1", "page", 7)', 'TypeError', 'past the end'],
  ['Move', 'Move("r1", "r1x")', 'Error', 'no node "r1x"'],
  // Delete
  ['Delete', 'Delete("nope")', 'Error', 'no node "nope"'],
  ['Delete', 'Delete(document)', 'TypeError', 'cannot be deleted'],
  ['Delete', 'Delete("b1/label")', 'Error', 'cannot be deleted from an instance'],
  ['Delete', 'Delete("b1/swap")', 'Error', 'cannot be deleted from an instance'],
  ['Delete', 'Delete("b1/slot")', 'Error', 'no node "b1/slot"'],
  ['Replace', 'Replace("btn", {type: "frame"})', 'Error', 'component with 1 instance'],
  ['Delete', 'Delete("btn")', 'Error', 'component with 1 instance'],
  // SetVariables
  ['SetVariables', 'SetVariables([1])', 'TypeError', 'expected an object'],
  [
    'SetVariables',
    'SetVariables({a: {type: "colour", value: 1}})',
    'TypeError',
    'must be {type, value}',
  ],
  ['SetVariables', 'SetVariables({a: {type: "number"}})', 'TypeError', 'has no value'],
  ['SetVariables', 'SetVariables({$a: {type: "number", value: 1}})', 'TypeError', 'without "$"'],
  // Get
  ['Get', 'Get("nope")', 'Error', 'no node "nope"'],
  ['Get', 'Get("page#2")', 'TypeError', 'not a node path'],
  ['Get', 'Get()', 'TypeError', 'first argument'],
  ['Get', 'Get(42)', 'TypeError', 'first argument'],
  ['Get', 'Get("page", {depth: -1})', 'TypeError', 'depth must be'],
  [
    'Get',
    'Get("page", () => { throw new RangeError("from visitor") })',
    'RangeError',
    'from visitor',
  ],
  ['Get', 'Get("nope", () => 1)', 'Error', 'no node "nope"'],
  // FindEmptySpace
  ['FindEmptySpace', 'FindEmptySpace()', 'TypeError', 'expected {width'],
  ['FindEmptySpace', 'FindEmptySpace({width: "a", height: 1})', 'TypeError', 'width must be'],
  [
    'FindEmptySpace',
    'FindEmptySpace({width: 1, height: 1, direction: "up"})',
    'TypeError',
    'direction must be',
  ],
  [
    'FindEmptySpace',
    'FindEmptySpace({width: 1, height: 1, nodeId: "nope"})',
    'Error',
    'no node "nope"',
  ],
  // TakeScreenshot
  ['TakeScreenshot', 'TakeScreenshot([])', 'TypeError', 'non-empty list'],
  ['TakeScreenshot', 'TakeScreenshot("page")', 'TypeError', 'non-empty list'],
  ['TakeScreenshot', 'TakeScreenshot(["nope"])', 'Error', 'no node "nope"'],
  ['TakeScreenshot', 'TakeScreenshot(["page"], {scale: 9})', 'TypeError', 'scale must be'],
  ['TakeScreenshot', 'TakeScreenshot(Array(7).fill("page"))', 'RangeError', 'at most 6'],
  // Export
  ['Export', 'Export(["page"], "gif", "x.gif")', 'TypeError', 'format must be one of'],
  ['Export', 'Export(["page"], "pdf", "x.pdf")', 'Error', 'pdf is not available'],
  ['Export', 'Export(["page"], "png", "")', 'TypeError', 'outPath must be'],
  ['Export', 'Export(["page"], "png", "../../x.png")', 'Error', 'outside the document folder'],
  ['Export', 'Export(["page", "btn"], "png", "x.png")', 'TypeError', 'same top-level frame'],
  ['Export', 'Export(["nope"], "png", "x.png")', 'Error', 'no node "nope"'],
  // Generate
  ['Generate', 'Generate({prompt: "a cat"})', 'Error', 'not available in Tusche'],
  // The snippet itself
  ['snippet', 'const a = (', 'SyntaxError', ''],
  ['snippet', 'missing + 1', 'ReferenceError', 'missing'],
  ['snippet', 'throw new Error("mine")', 'Error', 'mine'],
  ['snippet', 'const f = () => f(); f()', 'RangeError', 'call stack'],
];

describe('error paths: every call fails, rolls back and reports', () => {
  for (const [fn, code, name, part] of ERRORS) {
    test(`${fn}: ${code}`, async () => {
      const { path, session } = await open();
      const before = readFileSync(path, 'utf8');
      const result = await session.execute({
        input: `Insert("box", {type: "rectangle"})\n${code}`,
      });
      expect(result.ok).toBe(false);
      expect(result.error?.name).toBe(name);
      expect(result.error?.message).toContain(part);
      expect(result.editId).toMatch(/^e\d+$/);
      expect(readFileSync(path, 'utf8')).toBe(before);
      expect(formatResult(result).text).toStartWith(
        `error · rolled back · editId=${result.editId}`,
      );
    });
  }
});

describe('mutations succeed', () => {
  test('Insert returns ids and paths; names are reported', async () => {
    const result = await run(`
      const card = Insert("box", {type: "frame", name: "Card", children: [{type: "text", name: "T", content: "x", fill: "#000000"}]})
      const badge = Insert("b1/swap" === "x" ? "" : "box", {type: "rectangle"})
      Print(card.length, Insert(document, {type: "frame", name: "Top"}).length)
    `);
    expect(result).toMatchObject({ ok: true, counts: { inserted: 3 }, prints: ['5 5'] });
    expect(result.names.map(([name]) => name)).toEqual(['Card', 'Top']);
  });

  test('Insert into a frame of a component inside an instance', async () => {
    const doc = JSON.parse(SYNTHETIC);
    delete doc.children[1].children[0].descendants.slot;
    const { session } = await open(JSON.stringify(doc));
    const result = await session.execute({
      input:
        'Update("b1/slot", {children: [{type: "rectangle", width: 2, height: 2}]}); Print(Get("b1/slot", {depth: 1}).children[0].id)',
    });
    const refused = await session.execute({ input: 'Insert("b1/slot", {type: "rectangle"})' });
    expect(refused.error?.message).toContain('belongs to a component');
    expect(result.ok).toBe(true);
    expect(result.prints[0]).toMatch(/^b1\/\w{5}$/);
  });

  test('Copy, Update, Replace, Move, Delete, SetVariables', async () => {
    const { session } = await open();
    const result = await session.execute({
      input: `
        const c = Copy("box", "page", {name: "Box 2", descendants: {r1: {width: 20}}})
        const i = Copy("btn", "page", {descendants: {label: {content: "Go"}}})
        Update(c, {gap: 8})
        Update("b1/label", {content: "Saved"})
        const e = Replace("r1", {type: "ellipse", width: 10, height: 10})
        Move(c, "page", 0)
        Delete(e)
        SetVariables({gap: {type: "number", value: 4}})
        Print(Get(i).type, Get(i).ref, Get(c).children[0].width, Get("b1/label").content, GetVariables().variables.gap.value)
      `,
    });
    expect(result).toMatchObject({
      ok: true,
      counts: { inserted: 2, updated: 2, replaced: 1, moved: 1, deleted: 1, variables: 1 },
      prints: ['ref btn 20 Saved 4'],
    });
    expect(formatResult(result).text).toMatch(
      /^ok · 2 inserted · 2 updated · 1 deleted · 1 replaced · 1 moved · variables set · \d+ ms/,
    );
  });

  test('an error caught by the snippet undoes only its own operation', async () => {
    const result = await run(`
      Insert("box", {type: "rectangle", name: "Kept"})
      try { Move("r1", "page", 99) } catch (e) { Print(e.name) }
      Print(Get("box").children.length, Get("r1").id)
    `);
    expect(result).toMatchObject({ ok: true, prints: ['TypeError', '2 r1'] });
  });
});

describe('reads succeed', () => {
  test('Get, visitors with bounds, GetVariables, FindEmptySpace', async () => {
    const result = await run(`
      Print(Get("page").children.length)
      Print(Get("page", (n, ctx) => n.id === "box" ? ctx.bounds.width : undefined)[0])
      Print(Object.keys(GetVariables().variables))
      Print(FindEmptySpace({width: 10, height: 10}).x)
    `);
    expect(result).toMatchObject({ ok: true, prints: ['2', '10', '["color.fg"]', '700'] });
  });
});

describe('output', () => {
  test('Print is cut at the limit', async () => {
    const result = await run('Print("x".repeat(50)); Print("y".repeat(50)); Print("z")', {
      printChars: 60,
    });
    expect(result.prints).toEqual(['x'.repeat(50), `${'y'.repeat(9)}…`]);
  });

  test('Export writes a file after the commit; failed calls write nothing', async () => {
    const { path, session } = await open();
    const ok = await session.execute({ input: 'Print(Export(["page"], "svg", "out/page"))' });
    const file = join(dir, 'out', 'page.svg');
    expect(ok).toMatchObject({ ok: true, exported: [file], prints: [file] });
    expect(readFileSync(file, 'utf8')).toContain('<svg');
    const failed = await session.execute({ input: 'Export(["page"], "svg", "out/none"); throw 1' });
    expect(failed.ok).toBe(false);
    expect(existsSync(join(dir, 'out', 'none.svg'))).toBe(false);
    expect(path).toBeTruthy();
  });
});

describe('limits', () => {
  test('time', async () => {
    const result = await run('while (true) {}', { timeMs: 300 });
    expect(result.error).toMatchObject({ name: 'TimeoutError' });
    expect(result.error?.hint).toBeDefined();
  });

  test('operations', async () => {
    const result = await run('for (let i = 0; i < 6; i++) Insert("box", {type: "rectangle"})', {
      operations: 5,
    });
    expect(result.error).toMatchObject({
      name: 'RangeError',
      message: 'Insert(): more than 5 changes in one call',
    });
  });

  test('memory', async () => {
    const result = await run('new ArrayBuffer(64 * 1024 * 1024)', {
      memoryBytes: 16 * 1024 * 1024,
    });
    expect(result.error).toMatchObject({ name: 'MemoryError' });
  });
});

describe('edits', () => {
  test('0 matches, 2 matches, all: true, success forgets the editId', async () => {
    const { session } = await open();
    const failed = await session.execute({
      input: 'const w = "a"; const v = "a"; Insert("nope", {type: "frame"})',
    });
    const editId = failed.editId as string;
    expect(editId).toBe('e1');
    for (const [edits, part] of [
      [[{ find: 'zzz', replace: '' }], 'matched 0 times'],
      [[{ find: '"a"', replace: '"b"' }], 'matched 2 times'],
      [[], 'non-empty list'],
      [[{ find: 1, replace: '' }], 'edits[0] must be'],
    ] as const) {
      const result = await session.execute({ editId, edits });
      expect(result.error?.message).toContain(part);
      expect(result.editId).toBe(editId);
    }
    const again = await session.execute({
      editId,
      edits: [{ find: '"a"', replace: '"b"', all: true }],
    });
    expect(again).toMatchObject({
      ok: false,
      editId,
      error: { message: 'Insert(): no node "nope"' },
    });
    const fixed = await session.execute({ editId, edits: [{ find: '"nope"', replace: '"box"' }] });
    expect(fixed.ok).toBe(true);
    const gone = await session.execute({ editId, edits: [{ find: 'w', replace: 'x' }] });
    expect(gone).toMatchObject({ ok: false, error: { name: 'EditError' } });
    expect(gone.editId).toBeUndefined();
  });

  test('a new failure gets a new editId', async () => {
    const { session } = await open();
    expect((await session.execute({ input: 'throw 1' })).editId).toBe('e1');
    expect((await session.execute({ input: 'throw 2' })).editId).toBe('e2');
  });
});

describe('globals', () => {
  test('JSON globals persist, others are reported, failures keep the old ones', async () => {
    const { session } = await open();
    const first = await session.execute({ input: 'saved = {n: 1}; fn = () => 1' });
    expect(first.warnings).toMatchObject([{ code: 'global-not-saved' }]);
    await session.execute({ input: 'saved = {n: 2}; throw 1' });
    const next = await session.execute({ input: 'Print(saved.n, typeof fn)' });
    expect(next.prints).toEqual(['1 undefined']);
  });
});

describe('warnings', () => {
  const codes = (result: ExecResult) => result.warnings.map((w) => w.code);

  test.each([
    ['id-ignored', 'Insert("box", {type: "rectangle", id: "mine"})'],
    ['invisible-text', 'Insert("box", {type: "text", content: "x"})'],
    ['ignored-xy', 'Insert("box", {type: "rectangle", x: 5, width: 1, height: 1})'],
    [
      'clipped',
      'const f = Insert("box", {type: "frame", width: 10, height: 10, clip: true, layout: "none"}); Insert(f, {type: "rectangle", width: 50, height: 50})',
    ],
    ['zero-size', 'Insert("box", {type: "frame", layout: "vertical"})'],
    [
      'circular-size',
      'Insert("box", {type: "frame", layout: "vertical", children: [{type: "rectangle", height: 10, width: "fill_container"}]})',
    ],
    [
      'unknown-font',
      'Insert("box", {type: "text", content: "x", fill: "#000000", fontFamily: "No Such Font Tusche"})',
    ],
    [
      'unsupported-render',
      'Insert("box", {type: "rectangle", width: 5, height: 5, fill: {type: "shader", url: "x.glsl"}})',
    ],
    ['unknown-variable', 'Insert("box", {type: "rectangle", width: 5, height: 5, fill: "$nope"})'],
  ])('%s', async (code, snippet) => {
    const result = await run(snippet);
    expect(result.ok).toBe(true);
    expect(codes(result)).toContain(code);
  });

  test('a clean insert has no warnings; more than 20 are counted', async () => {
    expect((await run('Insert("box", {type: "rectangle", width: 5, height: 5})')).warnings).toEqual(
      [],
    );
    const many = await run(
      'for (let i = 0; i < 25; i++) Insert("box", {type: "text", content: "x"})',
    );
    expect(formatResult(many).text).toContain('… and 5 more');
  });
});

describe('the real file (fixtures/pen/eval/design.pen)', () => {
  const copyFixture = () => {
    const path = join(dir, `design${n++}.pen`);
    copyFileSync(FIXTURE, path);
    return path;
  };

  test('reads do not touch the file', async () => {
    const path = copyFixture();
    const session = await createExecutor({ engine }).open(path);
    const result = await session.execute({
      input:
        'Print(Get(document).children.length, Get((n) => n.type === "ref" ? 1 : undefined).length)',
    });
    expect(result).toMatchObject({ ok: true, saved: false, prints: ['7 360'] });
    expect(readFileSync(path)).toEqual(readFileSync(FIXTURE));
  });

  test('a copy of a board names only the copy and keeps old problems of the source quiet', async () => {
    const session = await createExecutor({ engine }).open(copyFixture());
    const result = await session.execute({
      input:
        'const c = Copy("eRmJH", document, {x: 0, y: 8000, name: "Board copy"}); Print(Get(c, {depth: 1}).children.filter((n) => n.reusable).length)',
    });
    expect(result).toMatchObject({ ok: true, prints: ['0'] });
    // Only fonts can be missing here (the test engine is offline).
    expect(result.warnings.filter((w) => w.code !== 'unknown-font')).toEqual([]);
    expect(result.names.map(([name]) => name)).toEqual(['Board copy']);
  });

  test('an edit rewrites the file in its own style and changes only what was edited', async () => {
    const path = copyFixture();
    const session = await createExecutor({ engine }).open(path);
    const result = await session.execute({
      input:
        'Update("j7KnT/cxenR", {content: "7"}); Print(Get("j7KnT/cxenR").content); Delete("ILWg4")',
    });
    expect(result.error?.message).toMatch(/component with \d+ instances/);
    const ok = await session.execute({ input: 'Update("j7KnT/cxenR", {content: "7"})' });
    expect(ok).toMatchObject({ ok: true, saved: true });
    const original = readFileSync(FIXTURE, 'utf8');
    const edited = readFileSync(path, 'utf8');
    const { format } = parsePen(original);
    expect(parsePen(edited).format).toEqual(format);
    const before = original.split('\n');
    const after = edited.split('\n');
    const changed = after.filter((line, i) => line !== before[i]);
    expect(after.length - before.length).toBeLessThanOrEqual(1);
    expect(changed.length).toBeLessThan(10);
    // Without edits the serializer gives the original bytes back.
    expect(serializePen(parsePen(original).doc, format)).toBe(original);
  });
});
