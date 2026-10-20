import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PenDocument } from '@tusche/pen-format';
import { createEngine, type Engine } from '../src/index.ts';

let engine: Engine;

beforeAll(async () => {
  // Offline and with an empty cache: only the bundled Inter is available.
  engine = await createEngine({
    allowNetwork: false,
    cacheDir: mkdtempSync(join(tmpdir(), 'tusche-engine-')),
  });
});

const doc = (children: unknown[]): PenDocument => ({ version: '2.21', children }) as PenDocument;

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const pngSize = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

describe('layout and bounds', () => {
  test('flex layout with fixed, fill and hugging children', async () => {
    const scene = await engine.open(
      doc([
        {
          type: 'frame',
          id: 'row',
          x: 40,
          y: 20,
          width: 300,
          gap: 10,
          padding: 10,
          fill: '#FFFFFF',
          children: [
            { type: 'rectangle', id: 'fixed', width: 100, height: 40, fill: '#FF0000' },
            {
              type: 'rectangle',
              id: 'grow',
              width: 'fill_container',
              height: 'fill_container',
              fill: '#00FF00',
            },
            {
              type: 'frame',
              id: 'hug',
              padding: 4,
              children: [{ type: 'rectangle', id: 'dot', width: 8, height: 12 }],
            },
          ],
        },
      ]),
    );
    const report = await scene.layout();
    expect(report.roots).toEqual(['row']);
    expect(await scene.bounds('row')).toMatchObject({ x: 40, y: 20, width: 300, height: 60 });
    expect(await scene.bounds('fixed')).toMatchObject({ x: 10, y: 10, width: 100, height: 40 });
    expect(await scene.bounds('hug')).toMatchObject({ width: 16, height: 20 });
    // 300 − 2×10 padding − 100 − 16 − 2×10 gap
    const grow = await scene.bounds('grow');
    expect(grow).toMatchObject({ x: 120, width: 144, height: 40 });
    expect(grow?.absolute).toMatchObject({ x: 160, y: 30 });
  });

  test('bounds by path inside an instance; text is measured', async () => {
    const scene = await engine.open(
      doc([
        {
          type: 'frame',
          id: 'button',
          reusable: true,
          padding: [8, 16],
          fill: '#222222',
          children: [{ type: 'text', id: 'label', content: 'OK', fontSize: 16, fill: '#FFFFFF' }],
        },
        {
          type: 'frame',
          id: 'screen',
          layout: 'vertical',
          gap: 8,
          children: [
            { type: 'ref', id: 'short', ref: 'button' },
            {
              type: 'ref',
              id: 'long',
              ref: 'button',
              descendants: { label: { content: 'Cancel everything' } },
            },
          ],
        },
      ]),
    );
    const short = await scene.bounds('short/label');
    const long = await scene.bounds('long/label');
    expect(short?.width).toBeGreaterThan(10);
    expect(long?.width).toBeGreaterThan((short?.width ?? 0) * 3);
    expect(short).toMatchObject({ x: 16, y: 8 });
    expect((await scene.bounds('long'))?.width).toBeCloseTo((long?.width ?? 0) + 32, 0);
    expect(await scene.bounds('missing')).toBeUndefined();
  });
});

describe('rendering', () => {
  const art = doc([
    {
      type: 'frame',
      id: 'card',
      width: 120,
      height: 80,
      layout: 'none',
      fill: '#FFFFFF',
      children: [
        { type: 'ellipse', id: 'sun', x: 20, y: 20, width: 40, height: 40, fill: '#FFAA00' },
        {
          type: 'icon',
          id: 'star',
          x: 70,
          y: 20,
          width: 32,
          height: 32,
          library: 'lucide',
          icon: 'star',
          fill: '#000000',
        },
      ],
    },
  ]);

  test('PNG of a top-level node and of a nested one; scale and size limit', async () => {
    const scene = await engine.open(art);
    const png = await scene.render(['card']);
    expect([...(png ?? []).slice(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(pngSize(png as Uint8Array)).toEqual({ width: 120, height: 80 });
    expect(pngSize((await scene.render(['card'], { scale: 2 })) as Uint8Array)).toEqual({
      width: 240,
      height: 160,
    });
    expect(
      pngSize((await scene.render(['card'], { scale: 4, maxSide: 300 })) as Uint8Array),
    ).toEqual({
      width: 300,
      height: 200,
    });
    expect(pngSize((await scene.render(['sun'])) as Uint8Array)).toEqual({ width: 40, height: 40 });
    expect(await scene.render(['nothing'])).toBeUndefined();
  });

  test('compare: identical renders match, a changed one does not', async () => {
    const before = (await (await engine.open(art)).render(['card'])) as Uint8Array;
    const same = (await (await engine.open(art)).render(['card'])) as Uint8Array;
    const changed = JSON.parse(
      JSON.stringify(art).replace('"fill":"#FFAA00"', '"fill":"#0000FF"'),
    ) as PenDocument;
    const after = (await (await engine.open(changed)).render(['card'])) as Uint8Array;
    expect(engine.compare(before, same).changedPixels).toBe(0);
    const diff = engine.compare(before, after);
    expect(diff.changedPixels).toBeGreaterThan(500);
    expect(diff.ratio).toBeGreaterThan(0.05);
    expect([...(diff.diff ?? []).slice(0, 8)]).toEqual(PNG_SIGNATURE);
  });

  test('invalidate rebuilds a top-level node from the document', async () => {
    const d = structuredClone(art) as unknown as { children: Record<string, unknown>[] };
    const scene = await engine.open(d as unknown as PenDocument);
    expect((await scene.bounds('card'))?.width).toBe(120);
    (d.children[0] as Record<string, unknown>).width = 200;
    expect((await scene.bounds('card'))?.width).toBe(120);
    scene.invalidate('card');
    expect((await scene.bounds('card'))?.width).toBe(200);
  });
});

test('gap is kept with space_between, as in CSS', async () => {
  const scene = await engine.open(
    doc([
      {
        type: 'frame',
        id: 'row',
        width: 200,
        gap: 12,
        justifyContent: 'space_between',
        children: [
          { type: 'rectangle', id: 'grow', width: 'fill_container', height: 10 },
          { type: 'rectangle', id: 'icon', width: 18, height: 18 },
        ],
      },
    ]),
  );
  expect(await scene.bounds('grow')).toMatchObject({ width: 170 });
  expect(await scene.bounds('icon')).toMatchObject({ x: 182 });
});

test('fill_container siblings share the space equally, padded or not', async () => {
  const scene = await engine.open(
    doc([
      {
        type: 'frame',
        id: 'row',
        width: 1472,
        gap: 20,
        children: [
          { type: 'frame', id: 'plain', width: 'fill_container', height: 10 },
          {
            type: 'frame',
            id: 'padded',
            width: 'fill_container',
            padding: [26, 28],
            layout: 'vertical',
          },
        ],
      },
    ]),
  );
  expect((await scene.bounds('plain'))?.width).toBe(726);
  expect((await scene.bounds('padded'))?.width).toBe(726);
});

test('auto-growing text never wraps, even when it overflows', async () => {
  const scene = await engine.open(
    doc([
      {
        type: 'frame',
        id: 'card',
        width: 120,
        layout: 'vertical',
        children: [{ type: 'text', id: 't', content: 'A rather long single line', fill: '#000' }],
      },
    ]),
  );
  const t = await scene.bounds('t');
  expect(t?.width).toBeGreaterThan(120);
  expect(t?.height).toBeLessThan(25);
});

describe('new versions of the document', () => {
  const card = (content: string, extra: unknown[] = []) => ({
    type: 'frame',
    id: 'card',
    layout: 'vertical',
    padding: 8,
    children: [{ type: 'text', id: 'label', content, fontSize: 16, fill: '#000000' }, ...extra],
  });
  const other = { type: 'rectangle', id: 'other', x: 400, width: 10, height: 10 };

  test('update re-projects only the changed top-level nodes', async () => {
    const scene = await engine.open(doc([card('Hi'), other]));
    await scene.layout();
    const short = await scene.bounds('label');
    const before = scene.projection.node('other');

    const next = doc([card('A much longer label'), other]);
    await scene.update(next, ['card']);
    expect(scene.doc).toBe(next);
    expect(scene.isLaidOut('card')).toBe(false);
    expect(scene.isLaidOut('other')).toBe(true);
    expect((await scene.bounds('label'))?.width).toBeGreaterThan((short?.width ?? 0) * 3);
    expect(scene.projection.node('other')).toBe(before);
  });

  test('added and removed top-level nodes', async () => {
    const scene = await engine.open(doc([card('Hi')]));
    await scene.layout();
    await scene.update(doc([other]), ['card', 'other']);
    expect(await scene.bounds('card')).toBeUndefined();
    expect(await scene.bounds('other')).toMatchObject({ x: 400, width: 10 });
  });

  test("'all' re-projects everything (variables changed)", async () => {
    const withVar = (width: number) =>
      ({
        version: '2.21',
        variables: { w: { type: 'number', value: width } },
        children: [{ type: 'rectangle', id: 'r', width: '$w', height: 10 }],
      }) as PenDocument;
    const scene = await engine.open(withVar(20));
    expect((await scene.bounds('r'))?.width).toBe(20);
    await scene.update(withVar(50), 'all');
    expect((await scene.bounds('r'))?.width).toBe(50);
  });

  test('new characters are added to the font subsets', async () => {
    const scene = await engine.open(doc([card('abc')]));
    await scene.layout();
    await scene.update(doc([card('Привет, мир')]), ['card']);
    expect((await scene.bounds('label'))?.width).toBeGreaterThan(40);
  });
});

describe('clipping', () => {
  const box = (children: unknown[], clip = true) =>
    doc([{ type: 'frame', id: 'box', width: 100, height: 100, layout: 'none', clip, children }]);
  const rect = (id: string, x: number, y: number) => ({
    type: 'rectangle',
    id,
    x,
    y,
    width: 40,
    height: 40,
    fill: '#FF0000',
  });

  test('inside, partially and fully outside a clipping frame', async () => {
    const scene = await engine.open(
      box([rect('inside', 10, 10), rect('edge', 80, 10), rect('out', 200, 10)]),
    );
    expect(await scene.clipping('inside')).toBeUndefined();
    expect(await scene.clipping('edge')).toEqual({ state: 'partially clipped', by: 'box' });
    expect(await scene.clipping('out')).toEqual({ state: 'fully clipped', by: 'box' });
  });

  test('without clip nothing is clipped; unknown paths are undefined', async () => {
    const scene = await engine.open(box([rect('out', 200, 10)], false));
    expect(await scene.clipping('out')).toBeUndefined();
    expect(await scene.clipping('nope')).toBeUndefined();
  });

  test('a nested node is clipped by a clipping ancestor further up', async () => {
    const scene = await engine.open(
      box([
        {
          type: 'frame',
          id: 'inner',
          x: 70,
          y: 0,
          layout: 'none',
          width: 60,
          height: 60,
          children: [rect('deep', 0, 0)],
        },
      ]),
    );
    expect(scene.isLaidOut('box')).toBe(false);
    expect(await scene.clipping('deep')).toEqual({ state: 'partially clipped', by: 'box' });
    expect(scene.isLaidOut('box')).toBe(true);
    expect(scene.clippingSync('deep')).toEqual({ state: 'partially clipped', by: 'box' });
    expect(scene.boundsSync('deep')).toMatchObject({ x: 0, absolute: { x: 70 } });
  });
});

describe('export', () => {
  const page = doc([
    {
      type: 'frame',
      id: 'page',
      width: 200,
      height: 100,
      fill: '#FFFFFF',
      children: [{ type: 'text', id: 'hello', content: 'Hello', fontSize: 24, fill: '#000000' }],
    },
  ]);
  const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

  test('raster formats', async () => {
    const scene = await engine.open(page);
    const png = await scene.export(['page'], 'png', { scale: 2 });
    expect([...(png ?? []).slice(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(pngSize(png as Uint8Array)).toEqual({ width: 400, height: 200 });
    const jpeg = await scene.export(['page'], 'jpeg');
    expect([...(jpeg ?? []).slice(0, 2)]).toEqual([0xff, 0xd8]);
    const webp = await scene.export(['page'], 'webp');
    expect(text(webp?.slice(0, 4))).toBe('RIFF');
    expect(text(webp?.slice(8, 12))).toBe('WEBP');
  });

  test('vector and code formats', async () => {
    const scene = await engine.open(page);
    expect(text(await scene.export(['page'], 'svg'))).toContain('<svg');
    await expect(scene.export(['page'], 'pdf')).rejects.toThrow(/svg or png/);
    const html = text(await scene.export(['page'], 'html-tailwind'));
    expect(html).toContain('<html');
    expect(html).toContain('Hello');
  });

  test('nothing to export', async () => {
    const scene = await engine.open(page);
    expect(await scene.export([], 'png')).toBeUndefined();
    expect(await scene.export(['nope'], 'svg')).toBeUndefined();
  });
});

describe('lint', () => {
  const page = () =>
    doc([
      {
        type: 'frame',
        id: 'card',
        width: 200,
        height: 100,
        fill: '#FFFFFF',
        children: [
          { type: 'text', id: 'low', content: 'Pale', fill: '#F4F4F4', fontSize: 16 },
          { type: 'text', id: 'tiny', content: 'Small print', fill: '#000000', fontSize: 6 },
        ],
      },
      { type: 'frame', id: 'other', width: 50, height: 50, fill: '#000000' },
    ]);

  test('OpenPencil rules report by pen path', async () => {
    const scene = await engine.open(page());
    const messages = await scene.lint();
    const found = (ruleId: string) => messages.filter((m) => m.ruleId === ruleId);
    expect(found('color-contrast')).toEqual([
      expect.objectContaining({ severity: 'error', path: 'low' }),
    ]);
    expect(found('min-text-size').map((m) => m.path)).toEqual(['tiny']);
    expect(messages.every((m) => !m.path.includes('#'))).toBe(true);
  });

  test('only the given nodes; unknown paths are skipped', async () => {
    const scene = await engine.open(page());
    const messages = await scene.lint(['tiny', 'nope']);
    expect(messages.some((m) => m.path === 'low')).toBe(false);
    expect(messages.some((m) => m.ruleId === 'min-text-size')).toBe(true);
    expect(await scene.lint(['nope'])).toEqual([]);
  });
});

describe('missing glyphs', () => {
  test('text whose font lacks some characters; only laid-out roots', async () => {
    const scene = await engine.open(
      doc([
        {
          type: 'frame',
          id: 'f',
          layout: 'vertical',
          children: [
            { type: 'text', id: 'cjk', content: 'Hi 漢字 漢', fill: '#000000' },
            { type: 'text', id: 'ru', content: 'Привет', fill: '#000000' },
          ],
        },
      ]),
    );
    expect(scene.missingGlyphs()).toEqual([]);
    await scene.layout();
    expect(scene.missingGlyphs()).toEqual([
      { path: 'cjk', family: 'Inter', style: 'Regular', characters: '漢字' },
    ]);
  });
});
