import { describe, expect, test } from 'bun:test';
import {
  collectIds,
  effectiveNode,
  generateId,
  joinIdPath,
  type PenDocument,
  resolveNodePath,
  splitIdPath,
} from '../src/index.ts';

// A small component library: a pill with a caption, a dialog with two pills,
// and an instance of the dialog that customizes nested captions.
const library = (): PenDocument =>
  ({
    version: '2.21',
    children: [
      {
        type: 'frame',
        id: 'pill',
        reusable: true,
        children: [{ type: 'text', id: 'caption', content: 'Go', fill: '#111111' }],
      },
      {
        type: 'ref',
        id: 'iconPill',
        ref: 'pill',
        reusable: true,
        descendants: { caption: { type: 'icon', id: 'glyph', library: 'lucide', icon: 'star' } },
      },
      {
        type: 'frame',
        id: 'dialog',
        reusable: true,
        children: [
          { type: 'text', id: 'body', content: 'Body', fill: '#111111' },
          {
            type: 'frame',
            id: 'actions',
            children: [
              { type: 'ref', id: 'yes', ref: 'pill', descendants: { caption: { content: 'Yes' } } },
              { type: 'ref', id: 'no', ref: 'pill' },
            ],
          },
        ],
      },
      {
        type: 'ref',
        id: 'quit',
        ref: 'dialog',
        descendants: {
          body: { content: 'Quit?' },
          'yes/caption': { fill: '#FF0000' },
          'no/caption': { type: 'text', id: 'stay', content: 'Stay', fill: '#00AA00' },
        },
      },
      { type: 'ref', id: 'star', ref: 'iconPill' },
    ],
  }) as PenDocument;

describe('id paths', () => {
  test('split and join', () => {
    expect(splitIdPath('a/b/c')).toEqual(['a', 'b', 'c']);
    expect(joinIdPath(['a', 'b'])).toBe('a/b');
  });

  test('a plain id finds any node in the tree', () => {
    expect(resolveNodePath(library(), 'actions')?.node.id).toBe('actions');
    expect(resolveNodePath(library(), 'missing')).toBeUndefined();
    expect(resolveNodePath(library(), '')).toBeUndefined();
  });

  test('a child of an instance, with overrides', () => {
    const resolved = resolveNodePath(library(), 'quit/body');
    expect(resolved?.node.id).toBe('body');
    expect(resolved?.instances.map((n) => n.id)).toEqual(['quit']);
    expect(effectiveNode(resolved as never)).toMatchObject({ content: 'Quit?', fill: '#111111' });
  });

  test('nested instances: inner override first, outer override wins', () => {
    const resolved = resolveNodePath(library(), 'quit/yes/caption');
    expect(resolved?.node.id).toBe('caption');
    expect(resolved?.instances.map((n) => n.id)).toEqual(['quit', 'yes']);
    expect(effectiveNode(resolved as never)).toMatchObject({ content: 'Yes', fill: '#FF0000' });
  });

  test('replacements from the outer instance', () => {
    const resolved = resolveNodePath(library(), 'quit/no/stay');
    expect(resolved?.node).toMatchObject({ id: 'stay', content: 'Stay' });
    expect(resolved?.instances.map((n) => n.id)).toEqual(['quit', 'no']);
    expect(resolved?.overrides).toEqual([]);
  });

  test('a component that is itself an instance', () => {
    expect(resolveNodePath(library(), 'star/glyph')?.node).toMatchObject({
      type: 'icon',
      icon: 'star',
    });
  });

  test('paths that cross a non-instance or a missing child fail', () => {
    expect(resolveNodePath(library(), 'actions/yes')).toBeUndefined();
    expect(resolveNodePath(library(), 'quit/nothing')).toBeUndefined();
    expect(resolveNodePath(library(), 'quit/body/deeper')).toBeUndefined();
  });

  test('resolving does not change the document', () => {
    const doc = library();
    const before = JSON.stringify(doc);
    effectiveNode(resolveNodePath(doc, 'quit/yes/caption') as never);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

// Instances that add nodes of their own: a `children` override, a replacement with
// children, the instance's own children and a deep `children` override.
const additions = (): PenDocument =>
  ({
    version: '2.21',
    children: [
      {
        type: 'frame',
        id: 'card',
        reusable: true,
        children: [
          { type: 'text', id: 'title', content: 'Title', fill: '#111111' },
          { type: 'frame', id: 'slot', children: [] },
        ],
      },
      {
        type: 'frame',
        id: 'deck',
        reusable: true,
        children: [{ type: 'ref', id: 'c1', ref: 'card' }],
      },
      {
        type: 'ref',
        id: 'filled',
        ref: 'card',
        descendants: {
          slot: { children: [{ type: 'text', id: 'extra', content: 'Extra', fill: '#222222' }] },
          extra: { fill: '#333333' },
          title: {
            type: 'frame',
            id: 'titleBox',
            children: [{ type: 'text', id: 'inner', content: 'Inner', fill: '#444444' }],
          },
        },
      },
      {
        type: 'ref',
        id: 'own',
        ref: 'card',
        children: [{ type: 'text', id: 'mine', content: 'Mine', fill: '#555555' }],
      },
      {
        type: 'ref',
        id: 'd',
        ref: 'deck',
        descendants: {
          'c1/slot': { children: [{ type: 'text', id: 'deep', content: 'Deep', fill: '#666666' }] },
        },
      },
    ],
  }) as PenDocument;

describe('nodes an instance adds itself', () => {
  test('a child of a children override, with its own override', () => {
    const resolved = resolveNodePath(additions(), 'filled/extra');
    expect(resolved?.node).toMatchObject({ id: 'extra', content: 'Extra' });
    expect(resolved?.inline).toBe(true);
    expect(effectiveNode(resolved as never)).toMatchObject({ fill: '#333333' });
  });

  test('a replacement and the nodes inside it', () => {
    const doc = additions();
    expect(resolveNodePath(doc, 'filled/titleBox')).toMatchObject({
      node: { id: 'titleBox' },
      inline: true,
    });
    expect(resolveNodePath(doc, 'filled/inner')).toMatchObject({
      node: { id: 'inner' },
      inline: true,
    });
  });

  test("the instance's own children replace the component root's", () => {
    expect(resolveNodePath(additions(), 'own/mine')).toMatchObject({
      node: { id: 'mine' },
      inline: true,
    });
  });

  test('a deep children override reaches into the nested instance', () => {
    const resolved = resolveNodePath(additions(), 'd/c1/deep');
    expect(resolved?.node).toMatchObject({ id: 'deep' });
    expect(resolved?.instances.map((n) => n.id)).toEqual(['d', 'c1']);
    expect(resolved?.inline).toBe(true);
  });

  test('component nodes are not inline: they change through descendants', () => {
    expect(resolveNodePath(additions(), 'filled/slot')?.inline).toBe(false);
    expect(resolveNodePath(additions(), 'd/c1/title')?.inline).toBe(false);
    expect(resolveNodePath(library(), 'star/glyph')?.inline).toBe(false);
  });

  test('a replacement made by the outer instance is inline', () => {
    expect(resolveNodePath(library(), 'quit/no/stay')?.inline).toBe(true);
  });
});

describe('ids', () => {
  test('collectIds includes replacement nodes', () => {
    const ids = collectIds(library());
    expect(ids.has('caption')).toBe(true);
    expect(ids.has('glyph')).toBe(true);
    expect(ids.has('stay')).toBe(true);
  });

  test('generated ids are short, unique and never contain "/"', () => {
    const taken = collectIds(library());
    const before = taken.size;
    for (let i = 0; i < 2000; i++) {
      const id = generateId(taken);
      expect(id).toMatch(/^[A-Za-z0-9]{5,}$/);
    }
    expect(taken.size).toBe(before + 2000);
  });

  test('a crowded id space makes ids longer instead of looping forever', () => {
    const taken = new Set<string>();
    for (let i = 0; i < 200; i++) generateId(taken, 1);
    expect(taken.size).toBe(200);
    expect([...taken].some((id) => id.length > 1)).toBe(true);
  });
});
