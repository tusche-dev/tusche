import { describe, expect, test } from 'bun:test';
import type { PenDocument } from '@tusche/pen-format';
import { projectDocument } from '../src/index.ts';

const doc = (children: unknown[], extra: Record<string, unknown> = {}): PenDocument =>
  ({ version: '2.21', ...extra, children }) as PenDocument;

const project = (children: unknown[], extra?: Record<string, unknown>) =>
  projectDocument(doc(children, extra));

describe('frames and layout', () => {
  test('flex layout, gap, padding and alignment', () => {
    const p = project([
      {
        type: 'frame',
        id: 'col',
        layout: 'vertical',
        gap: 8,
        padding: [4, 12],
        justifyContent: 'center',
        alignItems: 'end',
        children: [{ type: 'rectangle', id: 'r', width: 10, height: 10 }],
      },
    ]);
    const col = p.node('col');
    expect(col).toMatchObject({
      type: 'FRAME',
      layoutMode: 'VERTICAL',
      itemSpacing: 8,
      paddingTop: 4,
      paddingBottom: 4,
      paddingLeft: 12,
      paddingRight: 12,
      primaryAxisAlign: 'CENTER',
      counterAxisAlign: 'MAX',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
    });
    expect(col?.childIds).toEqual(['r']);
  });

  test('frames default to a horizontal layout that hugs; layout none keeps x and y', () => {
    const p = project([
      {
        type: 'frame',
        id: 'row',
        children: [{ type: 'rectangle', id: 'a', x: 50, y: 50, width: 4, height: 4 }],
      },
      {
        type: 'frame',
        id: 'free',
        layout: 'none',
        width: 100,
        height: 100,
        children: [{ type: 'rectangle', id: 'b', x: 50, y: 60, width: 4, height: 4 }],
      },
    ]);
    expect(p.node('row')).toMatchObject({ layoutMode: 'HORIZONTAL', primaryAxisSizing: 'HUG' });
    expect(p.node('a')).toMatchObject({ x: 0, y: 0 });
    expect(p.node('b')).toMatchObject({ x: 50, y: 60 });
  });

  test('fill_container fills the parent layout; outside a layout it takes the fallback', () => {
    const p = project([
      {
        type: 'frame',
        id: 'row',
        width: 300,
        children: [
          { type: 'rectangle', id: 'grow', width: 'fill_container', height: 'fill_container' },
          {
            type: 'rectangle',
            id: 'abs',
            layoutPosition: 'absolute',
            width: 'fill_container(40)',
            height: 10,
          },
        ],
      },
      { type: 'rectangle', id: 'lonely', width: 'fill_container(320)', height: 5 },
    ]);
    expect(p.node('grow')).toMatchObject({ layoutGrow: 1, layoutAlignSelf: 'STRETCH' });
    expect(p.node('abs')).toMatchObject({ layoutPositioning: 'ABSOLUTE', width: 40 });
    expect(p.node('lonely')).toMatchObject({ width: 320, layoutGrow: 0 });
  });

  test('fit_content around children that all fill it uses the fallback and warns', () => {
    const p = project([
      {
        type: 'frame',
        id: 'loop',
        width: 'fit_content(200)',
        height: 40,
        children: [{ type: 'rectangle', id: 'c', width: 'fill_container', height: 10 }],
      },
    ]);
    expect(p.node('loop')).toMatchObject({ width: 200, primaryAxisSizing: 'FIXED' });
    expect(p.warnings.map((w) => w.code)).toContain('circular-size');
  });

  test('disabled nodes are not projected', () => {
    const p = project([
      {
        type: 'frame',
        id: 'f',
        children: [
          { type: 'rectangle', id: 'on', width: 1, height: 1 },
          { type: 'rectangle', id: 'off', enabled: false, width: 1, height: 1 },
        ],
      },
    ]);
    expect(p.node('f')?.childIds).toEqual(['on']);
  });
});

describe('shapes', () => {
  test('ellipse arcs and rings', () => {
    const p = project([
      { type: 'ellipse', id: 'ring', width: 20, height: 20, innerRadius: 0.5 },
      { type: 'ellipse', id: 'pie', width: 20, height: 20, startAngle: 0, sweepAngle: 90 },
      { type: 'ellipse', id: 'disc', width: 20, height: 20 },
    ]);
    expect(p.node('ring')?.arcData?.innerRadius).toBe(0.5);
    const pie = p.node('pie')?.arcData;
    // 90° counter-clockwise from the right is -90°..0° clockwise.
    expect(pie?.startingAngle).toBeCloseTo(-Math.PI / 2);
    expect(pie?.endingAngle).toBeCloseTo(0);
    expect(p.node('disc')?.arcData).toBeNull();
  });

  test('polygon and corner radii', () => {
    const p = project([
      { type: 'polygon', id: 'hex', width: 10, height: 10, polygonCount: 6 },
      { type: 'rectangle', id: 'r', width: 10, height: 10, cornerRadius: [1, 2, 3, 4] },
    ]);
    expect(p.node('hex')).toMatchObject({ type: 'POLYGON', pointCount: 6 });
    expect(p.node('r')).toMatchObject({
      independentCorners: true,
      topLeftRadius: 1,
      topRightRadius: 2,
      bottomRightRadius: 3,
      bottomLeftRadius: 4,
    });
  });

  test('path: the view box is stretched onto the node box', () => {
    const p = project([
      {
        type: 'path',
        id: 'tri',
        geometry: 'M0 0L24 0L24 24Z',
        viewBox: [0, 0, 24, 24],
        width: 48,
        height: 12,
        fill: '#000',
      },
      { type: 'path', id: 'tight', geometry: 'M10 10L20 10L20 30Z', fill: '#000' },
    ]);
    const xs = p.node('tri')?.vectorNetwork?.vertices.map((v) => [v.x, v.y]);
    expect(xs).toEqual([
      [0, 0],
      [48, 0],
      [48, 12],
    ]);
    // Without a view box the geometry's tight bounds map onto the node.
    expect(p.node('tight')).toMatchObject({ width: 10, height: 20 });
    expect(p.node('tight')?.vectorNetwork?.vertices[0]).toMatchObject({ x: 0, y: 0 });
  });
});

describe('text', () => {
  test('textGrowth, line height multiplier and no default fill', () => {
    const p = project([
      { type: 'text', id: 'auto', content: 'Hi', width: 100 },
      {
        type: 'text',
        id: 'wrap',
        content: 'Привет',
        textGrowth: 'fixed-width',
        width: 120,
        fontSize: 20,
        lineHeight: 1.5,
        fontWeight: '600',
        fill: '#111111',
      },
      {
        type: 'text',
        id: 'box',
        content: 'x',
        textGrowth: 'fixed-width-height',
        width: 50,
        height: 30,
      },
      { type: 'text', id: 'price', content: '$5', fill: '#000' },
    ]);
    expect(p.node('auto')).toMatchObject({ textAutoResize: 'WIDTH_AND_HEIGHT', fills: [] });
    expect(p.node('wrap')).toMatchObject({
      textAutoResize: 'HEIGHT',
      width: 120,
      lineHeight: 30,
      fontWeight: 600,
      text: 'Привет',
    });
    expect(p.node('box')).toMatchObject({ textAutoResize: 'NONE', width: 50, height: 30 });
    expect(p.node('price')?.text).toBe('$5');
  });
});

describe('paints', () => {
  test('a stroke given as a list of fills (2.x) with per-side widths', () => {
    const p = project([
      { type: 'frame', id: 'a', width: 10, height: 10, stroke: ['#000000'] },
      {
        type: 'frame',
        id: 'b',
        width: 10,
        height: 10,
        stroke: { type: 'color', color: '#FF000080' },
        strokeWidth: { bottom: 2 },
        strokeAlignment: 'outer',
      },
    ]);
    expect(p.node('a')?.strokes).toHaveLength(1);
    expect(p.node('a')).toMatchObject({ strokeWeight: 1, strokeAlign: 'INSIDE' });
    expect(p.node('b')).toMatchObject({
      independentStrokeWeights: true,
      borderBottomWeight: 2,
      borderTopWeight: 0,
      strokeAlign: 'OUTSIDE',
    });
    expect(p.node('b')?.strokes[0]?.opacity).toBeCloseTo(128 / 255);
  });

  test('colors, gradients, images and the shader placeholder', () => {
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const p = projectDocument(
      doc([
        {
          type: 'rectangle',
          id: 'r',
          width: 10,
          height: 10,
          fill: [
            '#F00',
            {
              type: 'gradient',
              colors: [
                { color: '#000', position: 1 },
                { color: '#FFF', position: 0 },
              ],
            },
            { type: 'image', url: 'a.png', mode: 'contain' },
            { type: 'image', url: 'missing.png' },
          ],
        },
        {
          type: 'rectangle',
          id: 's',
          width: 10,
          height: 10,
          fill: { type: 'shader', url: 'x.glsl' },
        },
      ]),
      { loadAsset: (url) => (url === 'a.png' ? png : undefined) },
    );
    const fills = p.node('r')?.fills ?? [];
    expect(fills.map((f) => f.type)).toEqual(['SOLID', 'GRADIENT_LINEAR', 'IMAGE', 'SOLID']);
    expect(fills[1]?.gradientStops?.map((s) => s.position)).toEqual([0, 1]);
    expect(fills[2]).toMatchObject({ imageScaleMode: 'FIT' });
    expect(p.graph.images.get(fills[2]?.imageHash ?? '')).toBe(png);
    expect(p.warnings.map((w) => w.code)).toContain('missing-asset');
    expect(p.node('s')?.fills).toHaveLength(1);
    expect(p.warnings.find((w) => w.path === 's')?.code).toBe('stub');
  });

  test('effects', () => {
    const p = project([
      {
        type: 'frame',
        id: 'f',
        width: 10,
        height: 10,
        effect: [
          {
            type: 'shadow',
            shadowType: 'inner',
            offset: { x: 1, y: 2 },
            blur: 3,
            color: '#00000080',
          },
          { type: 'background_blur', radius: 8 },
        ],
      },
    ]);
    expect(p.node('f')?.effects).toMatchObject([
      { type: 'INNER_SHADOW', offset: { x: 1, y: 2 }, radius: 3 },
      { type: 'BACKGROUND_BLUR', radius: 8 },
    ]);
  });
});

describe('instances', () => {
  const library = [
    {
      type: 'frame',
      id: 'pill',
      reusable: true,
      fill: '#EEEEEE',
      children: [{ type: 'text', id: 'caption', content: 'Go', fill: '#111111' }],
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
  ];

  test('ids are pen paths; overrides, deep overrides and replacements apply', () => {
    const p = project([
      ...library,
      {
        type: 'ref',
        id: 'quit',
        ref: 'dialog',
        fill: '#FFFFFF',
        descendants: {
          body: { content: 'Quit?' },
          'yes/caption': { fill: '#FF0000' },
          'no/caption': { type: 'text', id: 'stay', content: 'Stay', fill: '#00AA00' },
        },
      },
    ]);
    expect(p.node('quit')?.fills).toHaveLength(1);
    expect(p.node('quit/body')?.text).toBe('Quit?');
    expect(p.node('quit/actions')?.childIds).toEqual(['quit/yes', 'quit/no']);
    const yes = p.node('quit/yes/caption');
    expect(yes?.text).toBe('Yes');
    expect(yes?.fills[0]?.color).toMatchObject({ r: 1, g: 0, b: 0 });
    // The replacement keeps the address of the node it replaced.
    expect(p.node('quit/no/caption')?.text).toBe('Stay');
    expect(p.stats.instances).toBe(3 + 2);
  });

  test('children replacement, enabled: false and component chains', () => {
    const p = project([
      ...library,
      {
        type: 'ref',
        id: 'iconPill',
        ref: 'pill',
        reusable: true,
        descendants: { caption: { content: 'Icon' } },
      },
      { type: 'ref', id: 'star', ref: 'iconPill', descendants: { caption: { fill: '#000000' } } },
      { type: 'ref', id: 'hidden', ref: 'dialog', descendants: { body: { enabled: false } } },
      {
        type: 'ref',
        id: 'custom',
        ref: 'dialog',
        descendants: { actions: { children: [{ type: 'text', id: 'only', content: 'One' }] } },
      },
    ]);
    expect(p.node('star/caption')).toMatchObject({ text: 'Icon' });
    expect(p.node('star/caption')?.fills[0]?.color).toMatchObject({ r: 0, g: 0, b: 0 });
    expect(p.node('hidden/body')).toBeUndefined();
    expect(p.node('custom/actions')?.childIds).toEqual(['custom/only']);
  });

  test('unknown components and descendants are reported', () => {
    const p = project([
      ...library,
      { type: 'ref', id: 'ghost', ref: 'nothing' },
      { type: 'ref', id: 'typo', ref: 'pill', descendants: { capton: { content: 'x' } } },
    ]);
    expect(p.warnings.filter((w) => w.code === 'unknown-ref').map((w) => w.path)).toEqual([
      'ghost',
      'typo',
    ]);
  });
});

describe('variables and themes', () => {
  const themed = {
    themes: { mode: ['dark', 'light'] },
    variables: {
      bg: {
        type: 'color',
        value: [
          { value: '#000000', theme: { mode: 'dark' } },
          { value: '#FFFFFF', theme: { mode: 'light' } },
        ],
      },
      pad: { type: 'number', value: 6 },
    },
  };
  const key = {
    type: 'frame',
    id: 'key',
    reusable: true,
    width: 10,
    height: 10,
    fill: '$bg',
    padding: '$pad',
    children: [{ type: 'rectangle', id: 'dot', width: 2, height: 2, fill: '$bg' }],
  };

  test('theme-dependent fills inside instances follow the theme where the instance is placed', () => {
    const p = projectDocument(
      doc(
        [
          key,
          { type: 'frame', id: 'darkScreen', children: [{ type: 'ref', id: 'k1', ref: 'key' }] },
          {
            type: 'frame',
            id: 'lightScreen',
            theme: { mode: 'light' },
            children: [
              { type: 'ref', id: 'k2', ref: 'key' },
              { type: 'ref', id: 'k3', ref: 'key', theme: { mode: 'dark' } },
            ],
          },
        ],
        themed,
      ),
    );
    const color = (id: string) => p.node(id)?.fills[0]?.color;
    expect(color('k1')).toMatchObject({ r: 0, g: 0, b: 0 });
    expect(color('k1/dot')).toMatchObject({ r: 0, g: 0, b: 0 });
    expect(color('k2')).toMatchObject({ r: 1, g: 1, b: 1 });
    expect(color('k2/dot')).toMatchObject({ r: 1, g: 1, b: 1 });
    expect(color('k3/dot')).toMatchObject({ r: 0, g: 0, b: 0 });
    expect(p.node('k2')?.paddingTop).toBe(6);
    expect(JSON.parse(p.node('k2')?.pluginData[0]?.value ?? '{}')).toEqual({
      fill: 'bg',
      padding: 'pad',
    });
  });
});

describe('icons and placeholders', () => {
  test('a lucide icon becomes vectors scaled to the box, stroked with the fill color', () => {
    const p = project([
      {
        type: 'icon',
        id: 'i',
        library: 'lucide',
        icon: 'star',
        width: 16,
        height: 16,
        fill: '#FF0000',
      },
      {
        type: 'icon',
        id: 'ph',
        library: 'phosphor',
        icon: 'star',
        weight: 700,
        width: 32,
        height: 32,
        fill: '#000',
      },
      { type: 'icon', id: 'nope', library: 'lucide', icon: 'no-such-icon', width: 16, height: 16 },
    ]);
    const icon = p.node('i');
    expect(icon).toMatchObject({ type: 'FRAME', fills: [] });
    const vector = p.node(icon?.childIds[0] ?? '');
    expect(vector).toMatchObject({ type: 'VECTOR', fills: [], strokeWeight: 2 * (16 / 24) });
    expect(vector?.strokes[0]?.color).toMatchObject({ r: 1, g: 0, b: 0 });
    const xs = vector?.vectorNetwork?.vertices.map((v) => v.x) ?? [];
    expect(Math.max(...xs)).toBeLessThanOrEqual(16);
    expect(p.node(p.node('ph')?.childIds[0] ?? '')?.fills).toHaveLength(1);
    expect(p.warnings.find((w) => w.path === 'nope')?.code).toBe('unknown-icon');
  });

  test('note, script and browser are shown as placeholders of the right size', () => {
    const p = project([
      { type: 'note', id: 'n', content: 'Remember', width: 200, height: 80 },
      { type: 'script', id: 's', width: 300, height: 100, scriptUri: 'gen.js' },
      { type: 'browser', id: 'b', width: 400, height: 300, url: 'https://example.com' },
    ]);
    expect(p.node('n')).toMatchObject({ type: 'FRAME', width: 200, height: 80 });
    expect(p.node('n#text')?.text).toBe('Remember');
    expect(p.node('s')).toMatchObject({ width: 300, height: 100, dashPattern: [6, 4] });
    expect(p.node('b#label')?.text).toBe('browser · https://example.com');
    expect(p.warnings.filter((w) => w.code === 'stub')).toHaveLength(3);
  });
});

describe('laziness', () => {
  test('top-level nodes are projected on demand, each on its own page', () => {
    const d = doc([
      { type: 'rectangle', id: 'a', width: 1, height: 1 },
      { type: 'rectangle', id: 'b', width: 1, height: 1 },
    ]);
    const p = projectDocument(d, { roots: ['b'] });
    expect(p.roots).toEqual(['b']);
    expect(p.node('a')).toBeUndefined();
    p.project(['a']);
    expect(p.roots).toEqual(['a', 'b']);
    expect(p.pageOf('a')).not.toBe(p.pageOf('b'));
    p.invalidate('a');
    expect(p.node('a')).toBeUndefined();
    expect(p.rootOf('a/b#1')).toBe('a');
    expect(p.rootOf('nothing')).toBeUndefined();
  });
});
