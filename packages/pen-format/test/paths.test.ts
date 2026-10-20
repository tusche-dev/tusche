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
    const resolved = resolveNodePath(library(), 'quit/no/caption');
    expect(resolved?.node).toMatchObject({ id: 'stay', content: 'Stay' });
  });

  test('a component that is itself an instance', () => {
    expect(resolveNodePath(library(), 'star/caption')?.node).toMatchObject({
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
