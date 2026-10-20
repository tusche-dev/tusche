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
