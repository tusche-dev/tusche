import { describe, expect, test } from 'bun:test';
import { type PenDocument, resolveNodePath, validatePen } from '@tusche/pen-format';
import { copy, insert, move, remove, replace, setVariables, update } from '../src/api/mutations.ts';
import { ExecError } from '../src/errors.ts';
import { Transaction } from '../src/transaction.ts';

const base = (): PenDocument =>
  ({
    version: '2.11',
    variables: { 'color.bg': { type: 'color', value: '#FFFFFF' } },
    children: [
      {
        type: 'frame',
        id: 'btn',
        name: 'Button',
        reusable: true,
        layout: 'horizontal',
        children: [
          { type: 'text', id: 'label', content: 'OK', fill: '#000000' },
          { type: 'frame', id: 'slot', layout: 'vertical', children: [] },
        ],
      },
      {
        type: 'frame',
        id: 'page',
        name: 'Page',
        width: 800,
        height: 600,
        children: [
          { type: 'ref', id: 'b1', ref: 'btn' },
          {
            type: 'frame',
            id: 'box',
            layout: 'vertical',
            children: [{ type: 'rectangle', id: 'r1' }],
          },
        ],
      },
    ],
  }) as unknown as PenDocument;

const errorOf = (fn: () => unknown): ExecError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof ExecError) return error;
    throw error;
  }
  throw new Error('expected an ExecError');
};

const node = (tx: Transaction, path: string) => resolveNodePath(tx.doc, path)?.node;
const valid = (doc: PenDocument) => validatePen(doc).filter((d) => d.level === 'error');

describe('Insert', () => {
  test('appends with generated ids, records names, keeps the base document', () => {
    const doc = base();
    const tx = new Transaction(doc);
    const id = insert(tx, 'box', {
      type: 'frame',
      name: 'Card',
      children: [{ type: 'text', name: 'Title', content: 'Hi', fill: '#111111' }],
    });
    const card = node(tx, id) as { children: { id: string }[] };
    expect(card.children[0]?.id).toMatch(/^[A-Za-z0-9]{5}$/);
    // Only the root of each operation is named, as in pen.dev.
    expect(tx.names.map(([name]) => name)).toEqual(['Card']);
    expect(tx.counts.inserted).toBe(1);
    expect((doc.children[1] as { children: unknown[] }).children[1]).toMatchObject({
      children: [{ id: 'r1' }],
    });
    expect(valid(tx.doc)).toEqual([]);
    expect(tx.dirtyRoots()).toEqual(new Set(['page']));
  });

  test('into the document makes a new top-level node', () => {
    const tx = new Transaction(base());
    const id = insert(tx, 'document', { type: 'frame', name: 'New' });
    expect(tx.doc.children.at(-1)?.id).toBe(id);
    expect(tx.dirtyRoots()).toEqual(new Set([id]));
  });

  test('an id in the input is ignored with a warning', () => {
    const tx = new Transaction(base());
    const id = insert(tx, 'box', { type: 'rectangle', id: 'mine' });
    expect(id).not.toBe('mine');
    expect(tx.warnings).toMatchObject([{ code: 'id-ignored' }]);
  });

  test('errors: unknown parent, "#" paths, a leaf parent, invalid properties', () => {
    const tx = new Transaction(base());
    expect(errorOf(() => insert(tx, 'nope', { type: 'frame' })).message).toBe(
      'Insert(): no node "nope"',
    );
    expect(errorOf(() => insert(tx, 'page#2', { type: 'frame' })).name).toBe('TypeError');
    expect(errorOf(() => insert(tx, 'r1', { type: 'frame' })).message).toContain(
      'only frames and groups',
    );
    const padding = errorOf(() => insert(tx, 'box', { type: 'text', content: 'x', padding: 12 }));
    expect(padding).toMatchObject({ name: 'TypeError', hint: expect.stringContaining('frame') });
    expect(errorOf(() => insert(tx, 'box', { name: 'no type' })).name).toBe('TypeError');
    expect(tx.changed).toBe(false);
  });

  test('a text without fill is a warning, not an error', () => {
    const tx = new Transaction(base());
    insert(tx, 'box', { type: 'text', content: 'x' });
    expect(tx.warnings.map((w) => w.code)).toEqual(['invisible-text']);
  });

  test('into a frame of an instance: refused, as in pen.dev; Update sets its children', () => {
    const tx = new Transaction(base());
    const refused = errorOf(() => insert(tx, 'b1/slot', { type: 'rectangle' }));
    expect(refused.message).toContain('belongs to a component');
    expect(refused.hint).toContain('Update("b1/slot", {children');
    update(tx, 'b1/slot', { children: [{ type: 'text', content: 'Badge', fill: '#000000' }] });
    const added = (
      node(tx, 'b1') as unknown as { descendants: { slot: { children: { id: string }[] } } }
    ).descendants.slot.children[0]?.id as string;
    expect(added).toMatch(/^[A-Za-z0-9]{5}$/);
    expect(node(tx, `b1/${added}`)).toMatchObject({ content: 'Badge' });
    // The component itself is untouched.
    expect(node(tx, 'slot')).toMatchObject({ children: [] });
  });

  test('changing a component makes every root that uses it dirty', () => {
    const tx = new Transaction(base());
    insert(tx, 'slot', { type: 'rectangle' });
    expect(tx.dirtyRoots()).toEqual(new Set(['btn', 'page']));
  });

  test('the operation limit', () => {
    const tx = new Transaction(base(), 3);
    for (let i = 0; i < 3; i++) insert(tx, 'box', { type: 'rectangle' });
    expect(errorOf(() => insert(tx, 'box', { type: 'rectangle' })).name).toBe('RangeError');
  });
});

describe('Copy', () => {
  test('a plain node: new ids everywhere, overrides and descendants by original ids', () => {
    const tx = new Transaction(base());
    const id = copy(tx, 'box', 'page', { name: 'Box 2', descendants: { r1: { width: 40 } } });
    const copied = node(tx, id) as { name: string; children: { id: string; width: number }[] };
    expect(copied.name).toBe('Box 2');
    expect(copied.children[0]?.id).not.toBe('r1');
    expect(copied.children[0]?.width).toBe(40);
    expect(valid(tx.doc)).toEqual([]);
  });

  test('a component becomes an instance', () => {
    const tx = new Transaction(base());
    const id = copy(tx, 'btn', 'box', { descendants: { label: { content: 'Cancel' } } });
    expect(node(tx, id)).toMatchObject({
      type: 'ref',
      ref: 'btn',
      descendants: { label: { content: 'Cancel' } },
    });
  });

  test('nested components lose reusable in a plain copy', () => {
    const doc = base();
    const tx = new Transaction(doc);
    const wrapper = insert(tx, 'document', { type: 'frame', name: 'Lib' });
    move(tx, 'btn', wrapper);
    const id = copy(tx, wrapper, 'document');
    const copied = node(tx, id) as { children: { reusable?: boolean }[] };
    expect(copied.children[0]?.reusable).toBeUndefined();
  });

  test('errors: forbidden overrides, unknown descendants', () => {
    const tx = new Transaction(base());
    expect(errorOf(() => copy(tx, 'box', 'page', { id: 'x' })).name).toBe('TypeError');
    expect(errorOf(() => copy(tx, 'box', 'page', { descendants: { zz: {} } })).message).toContain(
      '"zz"',
    );
  });
});

describe('Update', () => {
  test('changes and deletes properties; key order is kept', () => {
    const tx = new Transaction(base());
    update(tx, 'page', { width: 1024, name: null });
    const page = node(tx, 'page') as Record<string, unknown>;
    expect(page.width).toBe(1024);
    expect('name' in page).toBe(false);
    expect(Object.keys(page).slice(0, 2)).toEqual(['type', 'id']);
  });

  test('inside an instance: an override in descendants; null removes it', () => {
    const tx = new Transaction(base());
    update(tx, 'b1/label', { content: 'Save' });
    expect(node(tx, 'b1')).toMatchObject({ descendants: { label: { content: 'Save' } } });
    update(tx, 'b1/label', { content: null });
    expect(node(tx, 'b1')).not.toHaveProperty('descendants');
  });

  test('errors: immutable keys, invalid values, the document', () => {
    const tx = new Transaction(base());
    for (const key of ['id', 'type', 'ref']) {
      expect(errorOf(() => update(tx, 'page', { [key]: 'x' })).message).toContain(
        `"${key}" cannot be changed`,
      );
    }
    expect(errorOf(() => update(tx, 'page', { width: 'huge' })).message).toContain('at width');
    expect(errorOf(() => update(tx, 'b1/label', { fontSize: 'big' })).name).toBe('TypeError');
    expect(errorOf(() => update(tx, 'document', {})).hint).toContain('SetVariables');
    expect(errorOf(() => update(tx, 'page', { children: 5 })).message).toContain('list of nodes');
  });

  test('children replace the old ones and get new ids', () => {
    const tx = new Transaction(base());
    update(tx, 'box', { children: [{ type: 'ellipse', id: 'mine', width: 4, height: 4 }] });
    const children = (node(tx, 'box') as { children: { id: string; type: string }[] }).children;
    expect(children.map((c) => c.type)).toEqual(['ellipse']);
    expect(children[0]?.id).not.toBe('mine');
    expect(tx.warnings.map((w) => w.code)).toEqual(['id-ignored']);
  });
});

describe('Replace', () => {
  test('a new id; inside an instance a replacement addressed by its own id', () => {
    const tx = new Transaction(base());
    const top = replace(tx, 'r1', { type: 'ellipse', width: 10, height: 10 });
    expect(top).not.toBe('r1');
    expect(node(tx, top)).toMatchObject({ type: 'ellipse' });
    expect(node(tx, 'r1')).toBeUndefined();
    const id = replace(tx, 'b1/label', { type: 'icon', icon: 'check' });
    expect(id).toMatch(/^[A-Za-z0-9]{5}$/);
    const inner = `b1/${id}`;
    // The key stays the id of the component node; the old path is gone.
    expect(node(tx, 'b1')).toMatchObject({ descendants: { label: { type: 'icon', id } } });
    expect(node(tx, inner)).toMatchObject({ type: 'icon' });
    expect(node(tx, 'b1/label')).toBeUndefined();
    // Replacing the replacement edits it in place.
    const again = replace(tx, inner, { type: 'text', content: 'Back', fill: '#000000' });
    expect(node(tx, `b1/${again}`)).toMatchObject({ type: 'text', content: 'Back' });
    expect(Object.keys((node(tx, 'b1') as unknown as { descendants: object }).descendants)).toEqual(
      ['label'],
    );
  });

  test('a component with instances is refused', () => {
    const tx = new Transaction(base());
    expect(errorOf(() => replace(tx, 'btn', { type: 'frame' })).message).toContain('1 instance');
  });
});

describe('Move', () => {
  test('to another parent at an index, and within the same parent', () => {
    const tx = new Transaction(base());
    move(tx, 'r1', 'page', 0);
    expect((node(tx, 'page') as { children: { id: string }[] }).children.map((c) => c.id)).toEqual([
      'r1',
      'b1',
      'box',
    ]);
    move(tx, 'r1');
    expect((node(tx, 'page') as { children: { id: string }[] }).children.at(-1)?.id).toBe('r1');
  });

  test('errors: into itself, inside instances, bad index', () => {
    const tx = new Transaction(base());
    expect(errorOf(() => move(tx, 'page', 'box')).message).toContain('into itself');
    expect(errorOf(() => move(tx, 'b1/label', 'page')).hint).toContain('enabled: false');
    expect(errorOf(() => move(tx, 'r1', 'b1/slot')).message).toContain('into an instance');
    expect(errorOf(() => move(tx, 'r1', 'page', 9)).message).toContain('past the end');
    expect(errorOf(() => move(tx, 'r1', 'page', -1)).name).toBe('TypeError');
  });
});

describe('Delete', () => {
  test('removes a node; inside instances it is refused with a hint', () => {
    const tx = new Transaction(base());
    remove(tx, 'r1');
    expect(node(tx, 'r1')).toBeUndefined();
    expect(errorOf(() => remove(tx, 'b1/label')).hint).toContain('enabled: false');
  });

  test('a component with instances is refused; without them it goes', () => {
    const tx = new Transaction(base());
    expect(errorOf(() => remove(tx, 'btn')).message).toContain('1 instance');
    remove(tx, 'b1');
    remove(tx, 'btn');
    expect(tx.doc.children.map((c) => c.id)).toEqual(['page']);
  });

  test('an added child of an instance can be deleted', () => {
    const tx = new Transaction(base());
    update(tx, 'b1/slot', { children: [{ type: 'rectangle' }] });
    const id = (
      node(tx, 'b1') as unknown as { descendants: { slot: { children: { id: string }[] } } }
    ).descendants.slot.children[0]?.id as string;
    remove(tx, `b1/${id}`);
    expect(node(tx, `b1/${id}`)).toBeUndefined();
  });
});

describe('SetVariables', () => {
  test('merges, deletes with null, replaces, adds theme values', () => {
    const tx = new Transaction(base());
    setVariables(tx, {
      'color.fg': {
        type: 'color',
        value: [
          { value: '#000000', theme: { mode: 'light' } },
          { value: '#FFFFFF', theme: { mode: 'dark' } },
        ],
      },
    });
    expect(Object.keys(tx.doc.variables ?? {})).toEqual(['color.bg', 'color.fg']);
    expect(tx.doc.themes).toEqual({ mode: ['light', 'dark'] });
    expect(tx.dirtyRoots()).toBe('all');
    setVariables(tx, { 'color.bg': null });
    expect(Object.keys(tx.doc.variables ?? {})).toEqual(['color.fg']);
    setVariables(tx, { gap: { type: 'number', value: 8 } }, true);
    expect(Object.keys(tx.doc.variables ?? {})).toEqual(['gap']);
    expect(valid(tx.doc)).toEqual([]);
  });

  test('errors: bad definitions and "$" names', () => {
    const tx = new Transaction(base());
    expect(errorOf(() => setVariables(tx, { a: { type: 'colour', value: 1 } })).name).toBe(
      'TypeError',
    );
    expect(errorOf(() => setVariables(tx, { a: { type: 'number' } })).message).toContain(
      'no value',
    );
    expect(errorOf(() => setVariables(tx, { $a: { type: 'number', value: 1 } })).message).toContain(
      'without "$"',
    );
  });
});
