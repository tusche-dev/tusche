import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine, type Engine } from '@tusche/engine';
import type { PenDocument } from '@tusche/pen-format';
import { hostOps } from '../src/api/index.ts';
import { Outputs } from '../src/api/output.ts';
import { Reader } from '../src/api/reads.ts';
import { runSnippet } from '../src/sandbox.ts';
import { Transaction } from '../src/transaction.ts';

let engine: Engine;
const dir = mkdtempSync(join(tmpdir(), 'tusche-exec-'));

beforeAll(async () => {
  engine = await createEngine({ allowNetwork: false, cacheDir: join(dir, 'cache') });
});

const base = (): PenDocument =>
  ({
    version: '2.11',
    themes: { mode: ['light', 'dark'] },
    variables: {
      'color.fg': {
        type: 'color',
        value: [
          { value: '#111111', theme: { mode: 'light' } },
          { value: '#EEEEEE', theme: { mode: 'dark' } },
        ],
      },
    },
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
        children: [{ type: 'text', id: 'label', content: 'OK', fill: '$color.fg' }],
      },
      {
        type: 'frame',
        id: 'page',
        name: 'Page',
        x: 200,
        y: 0,
        width: 400,
        height: 300,
        clip: true,
        layout: 'vertical',
        children: [
          { type: 'ref', id: 'b1', ref: 'btn', descendants: { label: { content: 'Save' } } },
          {
            type: 'frame',
            id: 'list',
            layout: 'vertical',
            children: [
              {
                type: 'frame',
                id: 'row',
                children: [{ type: 'rectangle', id: 'deep', width: 10, height: 10 }],
              },
            ],
          },
          { type: 'rectangle', id: 'tall', width: 50, height: 900 },
          { type: 'path', id: 'p', geometry: 'M0 0L10 10', width: 10, height: 10 },
        ],
      },
    ],
  }) as unknown as PenDocument;

async function run(code: string, doc = base()) {
  const tx = new Transaction(doc);
  const scene = await engine.open(doc);
  const reader = new Reader(tx, scene);
  const outputs = new Outputs(reader, dir, [dir]);
  const result = await runSnippet({ code, ops: hostOps(tx, reader, outputs) });
  return { result, tx, outputs, reader, scene };
}

const printed = async (code: string, doc?: PenDocument) => {
  const { result, outputs } = await run(code, doc);
  if (!result.ok) throw new Error(`${result.error.name}: ${result.error.message}`);
  return outputs.prints;
};

describe('Get', () => {
  test('depth 2 by default, stubs below, path geometry hidden', async () => {
    const [json] = await printed('Print(Get("page"))');
    const page = JSON.parse(json as string);
    expect(page.children.map((c: { id: string }) => c.id)).toEqual(['b1', 'list', 'tall', 'p']);
    expect(page.children[1].children[0]).toMatchObject({
      id: 'row',
      children: [{ type: 'rectangle', id: 'deep' }],
    });
    const [stubbed] = await printed('Print(Get("page", {depth: 1}).children[1].children[0])');
    expect(JSON.parse(stubbed as string)).toEqual({ type: 'frame', id: 'row', children: 1 });
    expect(page.children[3].geometry).toBeUndefined();
    const [geometry] = await printed('Print(Get("p", {includePathGeometry: true}).geometry)');
    expect(geometry).toBe('M0 0L10 10');
  });

  test('instances: as refs by default, expanded on request; paths inside instances', async () => {
    const [plain, expanded, child] = await printed(
      'Print(Get("b1")); Print(Get("b1", {resolveInstances: true})); Print(Get("b1/label"))',
    );
    expect(JSON.parse(plain as string)).toMatchObject({ type: 'ref', ref: 'btn' });
    expect(JSON.parse(plain as string).children).toBeUndefined();
    expect(JSON.parse(expanded as string)).toMatchObject({
      type: 'frame',
      ref: 'btn',
      id: 'b1',
      children: [{ id: 'label', path: 'b1/label', content: 'Save' }],
    });
    expect(JSON.parse(child as string)).toMatchObject({
      id: 'label',
      path: 'b1/label',
      content: 'Save',
    });
  });

  test('resolveVariables uses the theme', async () => {
    const [light] = await printed('Print(Get("label", {resolveVariables: true}).fill)');
    expect(light).toBe('#111111');
  });

  test('the document gives top-level nodes; unknown paths fail', async () => {
    const [top] = await printed(
      'Print(Get(document).children.map(c => c.id + ":" + c.children.length))',
    );
    expect(top).toBe('["btn:1","page:4"]');
    const { result } = await run('Get("nope")');
    expect(result).toMatchObject({ ok: false, error: { message: 'Get(): no node "nope"' } });
  });

  test('sees changes of the same call', async () => {
    const [count] = await printed(
      'Insert("list", {type: "rectangle"}); Print(Get("list").children.length)',
    );
    expect(count).toBe('2');
  });
});

describe('Get with a visitor', () => {
  test('walks the tree lazily; undefined results are dropped; skipChildren', async () => {
    const [ids, skipped] = await printed(`
      Print(Get("page", (n) => n.id).join(","))
      Print(Get("page", (n, ctx) => { if (n.id === "list") ctx.skipChildren(); return n.id }).join(","))
    `);
    expect(ids).toBe('page,b1,list,row,deep,tall,p');
    expect(skipped).toBe('page,b1,list,tall,p');
  });

  test('over the whole document, with depth, index and parentCtx', async () => {
    const [roots, parents] = await printed(`
      Print(Get((n, ctx) => ctx.depth === 0 ? n.id : undefined).join(","))
      Print(Get((n, ctx) => ctx.parentCtx ? n.id + "<" + ctx.parentCtx.node.id + "#" + ctx.index : undefined, {depth: 1}).join(","))
    `);
    expect(roots).toBe('btn,page');
    expect(parents).toBe('label<btn#0,b1<page#0,list<page#1,tall<page#2,p<page#3');
  });

  test('bounds and problems come from the layout, after changes of the call', async () => {
    const [boxes, problems] = await printed(`
      Update("tall", {height: 100})
      Print(Get("page", (n, ctx) => n.id === "tall" ? ctx.bounds : undefined))
      Update("tall", {height: 900})
      Print(Get("page", (n, ctx) => ctx.problems ? n.id + ":" + ctx.problems : undefined))
    `);
    expect(JSON.parse(boxes as string)).toEqual([
      { x: 0, y: expect.any(Number), width: 50, height: 100 },
    ]);
    expect(problems).toBe('["tall:partially clipped","p:fully clipped"]');
  });

  test('resolved instances are walked by instance paths', async () => {
    const [paths] = await printed(
      'Print(Get("b1", (n) => n.path || n.id, {resolveInstances: true}).join(","))',
    );
    expect(paths).toBe('b1,b1/label');
  });
});

describe('other reads', () => {
  test('GetVariables', async () => {
    const [vars] = await printed(
      'const v = GetVariables(); Print(Object.keys(v.variables), v.themes.mode)',
    );
    expect(vars).toBe('["color.fg"] ["light","dark"]');
  });

  test('FindEmptySpace: right of everything, next to a node, errors', async () => {
    const [right, below] = await printed(`
      Print(FindEmptySpace({width: 100, height: 100}))
      Print(FindEmptySpace({width: 100, height: 100, direction: "bottom", padding: 20, nodeId: "btn"}))
    `);
    expect(JSON.parse(right as string)).toEqual({ x: 700, y: 0 });
    expect(JSON.parse(below as string)).toEqual({ x: 0, y: 60 });
    const { result } = await run('FindEmptySpace({width: -1, height: 1})');
    expect(result).toMatchObject({ ok: false, error: { name: 'TypeError' } });
  });
});

describe('output', () => {
  test('Print joins values; screenshots and exports are queued, not run', async () => {
    const { result, outputs } = await run(`
      Print("a", 1, {b: 2})
      TakeScreenshot(["page"], {scale: 2})
      Print(Export(["page"], "png", "out/page"))
    `);
    expect(result.ok).toBe(true);
    expect(outputs.prints[0]).toBe('a 1 {"b":2}');
    expect(outputs.screenshots).toEqual([{ path: 'page', scale: 2 }]);
    expect(outputs.exports).toEqual([
      { paths: ['page'], format: 'png', file: join(dir, 'out', 'page.png') },
    ]);
    expect(outputs.prints[1]).toBe(join(dir, 'out', 'page.png'));
  });

  test('errors: too many screenshots, unknown nodes, outside the folder, pdf, Generate', async () => {
    const cases: [string, string][] = [
      ['TakeScreenshot(["page","page","page","page","page","page","page"])', 'RangeError'],
      ['TakeScreenshot(["nope"])', 'Error'],
      ['Export(["page"], "png", "../../x.png")', 'Error'],
      ['Export(["page"], "pdf", "x.pdf")', 'Error'],
      ['Export(["page"], "gif", "x.gif")', 'TypeError'],
      ['Export(["page", "btn"], "png", "x.png")', 'TypeError'],
      ['Generate("image")', 'Error'],
    ];
    for (const [code, name] of cases) {
      const { result } = await run(code);
      expect(result, code).toMatchObject({ ok: false, error: { name } });
    }
  });
});
