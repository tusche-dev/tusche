import { describe, expect, test } from 'bun:test';
import { type Diagnostic, formatDiagnostic, type PenDocument, validatePen } from '../src/index.ts';
import { codes } from './helpers.ts';

const doc = (children: unknown[], extra: Record<string, unknown> = {}): PenDocument =>
  ({ version: '2.21', children, ...extra }) as PenDocument;

const text = (props: Record<string, unknown> = {}) => ({
  type: 'text',
  id: 't',
  content: 'Hi',
  fill: '#000000',
  ...props,
});

const only = (diagnostics: Diagnostic[], code: string) =>
  diagnostics.filter((d) => d.code === code);

describe('document level', () => {
  test('a minimal document is clean', () => {
    expect(validatePen(doc([]))).toEqual([]);
  });

  test('non-objects and missing parts are schema errors', () => {
    expect(codes(validatePen([]))).toEqual(['schema']);
    expect(codes(validatePen({ children: [] }), 'error')).toEqual(['schema']);
    expect(codes(validatePen({ version: '2.21' }), 'error')).toEqual(['schema']);
  });

  test('a newer version is a warning and schema problems become warnings', () => {
    const diagnostics = validatePen({
      version: '2.30',
      children: [{ type: 'rectangle', id: 'r', width: 'huge' }],
    });
    expect(codes(diagnostics, 'error')).toEqual([]);
    expect(codes(diagnostics, 'warning')).toEqual(['newer-version', 'schema']);
  });

  test('another major version is reported', () => {
    expect(codes(validatePen({ version: '1.9', children: [] }), 'error')).toEqual([
      'unsupported-version',
    ]);
  });

  test('unknown root keys are info', () => {
    expect(validatePen(doc([], { fileToken: 'x' }))).toMatchObject([
      { level: 'info', code: 'unknown-property', path: '$.fileToken' },
    ]);
  });
});

describe('errors', () => {
  test('id with a slash', () => {
    const [d] = only(validatePen(doc([text({ id: 'a/b' })])), 'invalid-id');
    expect(d).toMatchObject({ level: 'error', path: '$.children[0].id', nodeId: 'a/b' });
  });

  test('duplicate ids', () => {
    const diagnostics = validatePen(
      doc([{ type: 'frame', id: 'f', children: [text({ id: 'x' }), text({ id: 'x' })] }]),
    );
    expect(only(diagnostics, 'duplicate-id')).toMatchObject([
      { level: 'error', path: '$.children[0].children[1].id', nodeId: 'x' },
    ]);
  });

  test('layout properties on a text node', () => {
    const [d] = only(validatePen(doc([text({ padding: 8 })])), 'layout-on-non-frame');
    expect(d).toMatchObject({ level: 'error', path: '$.children[0].padding' });
    expect(d?.message).toContain('only works on frames');
  });

  test('percentages and calc() in sizes', () => {
    for (const width of ['50%', 'calc(100% - 8px)', '10vw']) {
      const [d] = validatePen(doc([{ type: 'rectangle', id: 'r', width }]));
      expect(d).toMatchObject({ level: 'error', code: 'schema', path: '$.children[0].width' });
      expect(d?.message).toContain('percentages');
    }
  });

  test('sizing modes with and without fallback are fine', () => {
    for (const width of [
      'fit_content',
      'fill_container',
      'fit_content(320)',
      'fill_container(1.5)',
      12,
      '$w',
    ]) {
      const diagnostics = validatePen(
        doc([{ type: 'rectangle', id: 'r', width }], {
          variables: { w: { type: 'number', value: 1 } },
        }),
      );
      expect(codes(diagnostics, 'error')).toEqual([]);
    }
  });

  test('a bad nested value names the exact property', () => {
    const [d] = validatePen(
      doc([
        {
          type: 'frame',
          id: 'f',
          fill: [{ type: 'image', url: 'a.png', mode: 'tile' }],
          children: [],
        },
      ]),
    );
    expect(d).toMatchObject({ level: 'error', code: 'schema', path: '$.children[0].fill[0].mode' });
    expect(d?.message).toContain('"cover" | "contain" | "stretch"');
    expect(formatDiagnostic(d as Diagnostic)).toBe(
      `error schema $.children[0].fill[0].mode (id f): ${d?.message}`,
    );
  });

  test('bad colors', () => {
    const [d] = validatePen(doc([text({ fill: 'red' })]));
    expect(d).toMatchObject({ level: 'error', code: 'schema', path: '$.children[0].fill' });
  });
});

describe('warnings', () => {
  test('text without fill', () => {
    const { fill: _fill, ...noFill } = text();
    expect(codes(validatePen(doc([noFill])))).toEqual(['text-without-fill']);
  });

  test('fit-content frame whose children all fill it', () => {
    const diagnostics = validatePen(
      doc([
        {
          type: 'frame',
          id: 'f',
          layout: 'vertical',
          children: [{ type: 'rectangle', id: 'r', width: 'fill_container', height: 10 }],
        },
      ]),
    );
    expect(only(diagnostics, 'circular-size')).toMatchObject([
      { level: 'warning', path: '$.children[0].width' },
    ]);
  });

  test('no cycle when the frame has a fixed size or no layout', () => {
    for (const frame of [{ width: 100 }, { layout: 'none' }]) {
      const diagnostics = validatePen(
        doc([
          {
            type: 'frame',
            id: 'f',
            height: 10,
            ...frame,
            children: [{ type: 'rectangle', id: 'r', width: 'fill_container', height: 10 }],
          },
        ]),
      );
      expect(only(diagnostics, 'circular-size')).toEqual([]);
    }
  });

  test('unknown variables, themes and node types', () => {
    const diagnostics = validatePen(
      doc(
        [
          {
            type: 'frame',
            id: 'f',
            theme: { mode: 'sepia', density: 'x' },
            fill: '$bg',
            children: [],
          },
          { type: 'sticker', id: 's' },
          { type: 'rectangle', id: 'lib', fill: '$kit:primary' },
        ],
        {
          themes: { mode: ['light', 'dark'] },
          variables: { fg: { type: 'color', value: '$nope' } },
        },
      ),
    );
    expect(codes(diagnostics, 'warning').sort()).toEqual([
      'unknown-node-type',
      'unknown-theme',
      'unknown-theme',
      'unknown-variable',
      'unknown-variable',
    ]);
  });

  test('a price in text content is not a variable', () => {
    expect(validatePen(doc([text({ content: '$99' })]))).toEqual([]);
    expect(codes(validatePen(doc([text({ content: '$title' })])))).toEqual(['unknown-variable']);
  });
});

describe('instances', () => {
  const button = {
    type: 'frame',
    id: 'button',
    reusable: true,
    children: [{ type: 'text', id: 'label', content: 'OK', fill: '#000000' }],
  };

  test('overrides are checked against the component', () => {
    const diagnostics = validatePen(
      doc([
        button,
        {
          type: 'ref',
          id: 'b1',
          ref: 'button',
          padding: 4,
          fill: 'blue',
          descendants: { label: { content: 'Save', fontSize: 'big', gap: 2 } },
        },
      ]),
    );
    expect(diagnostics.map((d) => `${d.code} ${d.path}`).sort()).toEqual([
      'layout-on-non-frame $.children[1].descendants.label.gap',
      'schema $.children[1].descendants.label.fontSize',
      'schema $.children[1].fill',
    ]);
  });

  test('replacements are validated as nodes', () => {
    const diagnostics = validatePen(
      doc([
        button,
        {
          type: 'ref',
          id: 'b2',
          ref: 'button',
          descendants: {
            label: { type: 'icon', id: 'i', library: 'lucide', icon: 'check', width: '5%' },
          },
        },
      ]),
    );
    expect(diagnostics.map((d) => `${d.code} ${d.path}`)).toEqual([
      'schema $.children[1].descendants.label.width',
    ]);
  });

  test('missing components and descendants', () => {
    const diagnostics = validatePen(
      doc([
        button,
        { type: 'ref', id: 'b3', ref: 'nope' },
        { type: 'ref', id: 'b4', ref: 'button', descendants: { ghost: { enabled: false } } },
        { type: 'ref', id: 'b5', ref: 'kit:button' },
      ]),
    );
    expect(codes(diagnostics)).toEqual(['unknown-ref', 'unknown-descendant']);
  });

  test('explicit defaults are info and can be turned off', () => {
    const node = { type: 'frame', id: 'f', clip: false, opacity: 1, children: [] };
    expect(codes(validatePen(doc([node])))).toEqual(['explicit-default', 'explicit-default']);
    expect(validatePen(doc([node]), { explicitDefaults: false })).toEqual([]);
  });
});
