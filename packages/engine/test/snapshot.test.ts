import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderNodesToImage } from '@open-pencil/core/io/formats/raster';
import type { PenDocument } from '@tusche/pen-format';
import {
  createEngine,
  decodeMessage,
  type Engine,
  encodeMessage,
  loadedFontFiles,
  type RootSnapshot,
  snapshotRoot,
} from '../src/index.ts';
import { PreviewScene } from '../src/preview/scene.ts';

let engine: Engine;

beforeAll(async () => {
  engine = await createEngine({
    allowNetwork: false,
    cacheDir: mkdtempSync(join(tmpdir(), 'tusche-snapshot-')),
  });
});

const doc = (children: unknown[]): PenDocument => ({ version: '2.21', children }) as PenDocument;

const card = (id: string, x: number, title: string) => ({
  type: 'frame',
  id,
  x,
  y: 0,
  width: 240,
  layout: 'vertical',
  gap: 8,
  padding: 16,
  fill: '#FFFFFF',
  cornerRadius: 12,
  stroke: '#DDDDDD',
  strokeWidth: 1,
  children: [
    {
      type: 'text',
      id: `${id}-title`,
      content: title,
      fontSize: 20,
      fontWeight: '600',
      fill: '#111111',
    },
    {
      type: 'icon_font',
      id: `${id}-icon`,
      iconFontFamily: 'lucide',
      iconFontName: 'star',
      width: 24,
      height: 24,
      fill: '#E5A000',
    },
    {
      type: 'ref',
      id: `${id}-button`,
      ref: 'button',
      descendants: { label: { content: 'Открыть' } },
    },
  ],
});

const button = {
  type: 'frame',
  id: 'button',
  x: 0,
  y: 400,
  reusable: true,
  padding: [8, 16],
  fill: '#222222',
  cornerRadius: 6,
  children: [{ type: 'text', id: 'label', content: 'OK', fontSize: 14, fill: '#FFFFFF' }],
};

/** What the page does with an update: decode it and apply it to its scene. */
function receive(page: PreviewScene, order: string[], roots: RootSnapshot[]) {
  const message = decodeMessage(
    encodeMessage({ type: 'update', file: 'test.pen', order, roots, fonts: [] }),
  );
  if (message.type !== 'update') throw new Error('expected an update');
  page.apply(message.order, message.roots);
}

describe('preview snapshot', () => {
  test('the page draws a restored scene exactly as the engine renders it', async () => {
    const scene = await engine.open(
      doc([button, card('a', 0, 'Привет, мир'), card('b', 300, 'Second card')]),
    );
    const page = new PreviewScene();
    const roots: RootSnapshot[] = [];
    for (const id of scene.projection.topLevelIds) {
      const snapshot = await snapshotRoot(scene, id);
      if (snapshot) roots.push(snapshot);
    }
    expect(roots.map((r) => r.id)).toEqual(['button', 'a', 'b']);
    expect(roots[1]?.nodes[0]?.id).toBe('a');
    receive(page, scene.projection.topLevelIds, roots);
    expect(page.roots).toEqual(['button', 'a', 'b']);

    for (const id of page.roots) {
      const direct = await scene.export([id], 'png');
      engine.renderer.invalidateAllPictures();
      const restored = renderNodesToImage(
        engine.ck,
        engine.renderer,
        page.graph,
        page.pageId,
        [id],
        {
          scale: 1,
          format: 'PNG',
        },
      );
      expect(direct).toBeDefined();
      expect(restored).toBeDefined();
      const comparison = engine.compare(direct as Uint8Array, restored as Uint8Array);
      expect(comparison.ratio).toBe(0);
    }
    expect(page.bounds(['b'])).toMatchObject({ x: 300, y: 0, width: 240 });
  });

  test('updates replace and drop top-level nodes; hit test and node info by pen path', async () => {
    const first = await engine.open(doc([button, card('a', 0, 'One'), card('b', 300, 'Two')]));
    const page = new PreviewScene();
    const all = await Promise.all(
      first.projection.topLevelIds.map((id) => snapshotRoot(first, id)),
    );
    receive(page, first.projection.topLevelIds, all as RootSnapshot[]);
    const before = page.graph.nodes.size;

    // `b` is gone, `a` changed (one more child), `c` is new and painted first.
    const next = card('a', 0, 'One');
    next.children.push({
      type: 'text',
      id: 'a-extra',
      content: 'More',
      fontSize: 12,
      fill: '#333333',
    } as never);
    const second = await engine.open(doc([card('c', 600, 'Three'), button, next]));
    const changed = await Promise.all(['c', 'a'].map((id) => snapshotRoot(second, id)));
    receive(page, ['c', 'button', 'a'], changed as RootSnapshot[]);

    expect(page.roots).toEqual(['c', 'button', 'a']);
    expect(page.has('b')).toBe(false);
    expect(page.has('b-title')).toBe(false);
    expect(page.has('a-extra')).toBe(true);
    expect(page.graph.nodes.size).toBe(before + 1);

    const title = page.info('a-title');
    expect(title).toMatchObject({ id: 'a-title', type: 'TEXT', ancestors: [{ id: 'a' }] });
    const b = title?.bounds;
    if (!b) throw new Error('no bounds');
    expect(page.nodeAt(b.x + 2, b.y + b.height / 2)).toBe('a-title');
    // Inside an instance the id is the path of the node.
    const label = page.info('a-button/label');
    expect(label?.ancestors.map((a) => a.id)).toEqual(['a', 'a-button']);
    expect(page.nodeAt(-50, -50)).toBeNull();
    // The padding of the card: the stroke overlay (`a#stroke`) stands for the card.
    expect(page.has('a#stroke')).toBe(true);
    expect(page.nodeAt(4, 4)).toBe('a');
  });

  test('loaded font files: every face with stable ids', async () => {
    const scene = await engine.open(doc([card('a', 0, 'Fonts')]));
    await scene.layout();
    const files = loadedFontFiles();
    const inter = files.filter((f) => f.family === 'Inter');
    expect(inter.length).toBeGreaterThan(0);
    expect(inter.every((f) => /^[0-9a-f]{16}$/.test(f.id) && f.data.byteLength > 1000)).toBe(true);
    expect(loadedFontFiles().map((f) => f.id)).toEqual(files.map((f) => f.id));
  });

  test('a node that is not top-level has no snapshot', async () => {
    const scene = await engine.open(doc([card('a', 0, 'One')]));
    expect(await snapshotRoot(scene, 'a-title')).toBeUndefined();
    expect(await snapshotRoot(scene, 'missing')).toBeUndefined();
  });
});
