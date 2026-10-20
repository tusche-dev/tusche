import { describe, expect, test } from 'bun:test';
import {
  createNode,
  DEFAULT_FORMAT,
  hasErrors,
  migratePen,
  PenParseError,
  parsePen,
  serializePen,
  validatePen,
  withChanges,
} from '../src/index.ts';
import { readFixture } from './helpers.ts';

describe('eval fixture (2.17)', () => {
  const raw = readFixture('pen/eval/design.pen');

  test('validates without errors or warnings', () => {
    const { doc } = parsePen(raw);
    const problems = validatePen(doc).filter((d) => d.level !== 'info');
    expect(problems).toEqual([]);
  });

  test('round-trips byte for byte', () => {
    const { doc, format } = parsePen(raw);
    expect(serializePen(doc, format)).toBe(raw);
  });

  test('migrates to 2.21 and stays valid and stable', () => {
    const { doc, format } = parsePen(raw);
    const result = migratePen(doc);
    expect(result.from).toBe('2.17');
    expect(result.to).toBe('2.21');
    expect(hasErrors(validatePen(doc))).toBe(false);

    const migrated = serializePen(doc, format);
    // Nothing in this file needs converting: only the version changes.
    expect(migrated).toBe(raw.replace('"version": "2.17"', '"version": "2.21"'));
    const again = parsePen(migrated);
    expect(serializePen(again.doc, again.format)).toBe(migrated);
  });
});

describe('formatting is preserved', () => {
  test('CRLF and a trailing newline', () => {
    const raw = '{\r\n  "version": "2.6",\r\n  "children": []\r\n}\r\n';
    const { doc, format } = parsePen(raw);
    expect(format).toEqual({ indent: '  ', eol: '\r\n', finalNewline: true, bom: false });
    expect(serializePen(doc, format)).toBe(raw);
  });

  test('tabs, BOM and single-line files', () => {
    for (const raw of [
      '﻿{\n\t"version": "2.21",\n\t"children": [\n\t\t1\n\t]\n}',
      '{"version":"2.21","children":[{"type":"frame","id":"a"}]}',
    ]) {
      const { doc, format } = parsePen(raw);
      expect(serializePen(doc, format)).toBe(raw);
    }
  });

  test('new documents are written like pen.dev writes them', () => {
    const doc = { children: [], version: '2.21' };
    expect(serializePen(doc)).toBe(JSON.stringify({ version: '2.21', children: [] }, null, 2));
    expect(DEFAULT_FORMAT.finalNewline).toBe(false);
  });

  test('numbers are written like JSON.stringify, without -0', () => {
    const { doc, format } = parsePen('{"version":"2.21","children":[],"n":[-0,1e21,0.1,1.5e-7]}');
    expect(serializePen(doc, format)).toBe(
      '{"version":"2.21","children":[],"n":[0,1e+21,0.1,1.5e-7]}',
    );
  });
});

describe('key order', () => {
  test('source order is kept, including integer-like keys', () => {
    // JavaScript would list "12345" and "7" first; the file has them last.
    const raw =
      '{"version":"2.21","children":[{"id":"inst","type":"ref","ref":"comp","descendants":{"label":{"content":"A"},"12345":{"content":"B"},"7":{"enabled":false}}}]}';
    const { doc, format } = parsePen(raw);
    expect(serializePen(doc, format)).toBe(raw);
  });

  test('a key added to an existing node goes next to its canonical neighbours', () => {
    const raw =
      '{"version":"2.21","children":[{"type":"frame","id":"a","width":10,"gap":4,"children":[]}]}';
    const { doc, format } = parsePen(raw);
    const frame = doc.children[0] as Record<string, unknown>;
    frame.fill = '#fff'; // JavaScript appends it last
    frame.myPlugin = true; // unknown key
    frame.name = 'Card';
    expect(serializePen(doc, format)).toBe(
      '{"version":"2.21","children":[{"type":"frame","id":"a","name":"Card","width":10,"gap":4,"fill":"#fff","myPlugin":true,"children":[]}]}',
    );
  });

  test('withChanges keeps the order of the original object', () => {
    const { doc, format } = parsePen(
      '{"version":"2.21","children":[{"id":"r","type":"ref","ref":"c","x":1}]}',
    );
    const node = doc.children[0] as Record<string, unknown>;
    doc.children[0] = withChanges(node, { x: 2, name: 'Btn' }) as never;
    expect(serializePen(doc, format)).toBe(
      '{"version":"2.21","children":[{"id":"r","type":"ref","name":"Btn","ref":"c","x":2}]}',
    );
    expect(node.x).toBe(1);
  });

  test('new nodes get the canonical order', () => {
    const node = createNode({
      children: [],
      fill: '#000',
      height: 10,
      zzz: 1,
      id: 'n',
      descendants: {},
      name: 'N',
      type: 'frame',
    });
    expect(Object.keys(node)).toEqual([
      'type',
      'id',
      'name',
      'height',
      'fill',
      'zzz',
      'descendants',
      'children',
    ]);
    const doc = { version: '2.21', children: [{ name: 'x', id: 'q', type: 'text' }] };
    expect(serializePen(doc, { indent: '' })).toBe(
      '{"version":"2.21","children":[{"type":"text","id":"q","name":"x"}]}',
    );
  });
});

describe('unknown data survives a round trip', () => {
  test('unknown keys at every level', () => {
    const raw = JSON.stringify(
      {
        version: '2.21',
        children: [
          {
            type: 'frame',
            id: 'a',
            futureProp: { nested: [1, 2] },
            fill: [{ type: 'gradient', colors: [], futureGradientKey: 'x' }],
            children: [{ type: 'hologram', id: 'b', beam: 3 }],
          },
        ],
        variables: { c: { type: 'color', value: '#fff', scope: 'all' } },
        fileToken: 'abc',
      },
      null,
      2,
    );
    const { doc, format } = parsePen(raw);
    expect(serializePen(doc, format)).toBe(raw);
    const diagnostics = validatePen(doc);
    expect(hasErrors(diagnostics)).toBe(false);
    expect(diagnostics.map((d) => d.code)).toContain('unknown-node-type');
  });

  test('a "__proto__" key stays plain data', () => {
    const raw = '{"version":"2.21","children":[],"x":{"__proto__":{"polluted":true}}} // c';
    const { doc, format } = parsePen(raw);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(serializePen(doc, format)).toBe(
      '{"version":"2.21","children":[],"x":{"__proto__":{"polluted":true}}}',
    );
  });
});

describe('JSONC', () => {
  test('comments and trailing commas are read, plain JSON is written', () => {
    const raw =
      '{\n  // pen.dev accepts comments\n  "version": "2.21",\n  "children": [/* none */],\n}';
    const { doc, format, jsonc } = parsePen(raw);
    expect(jsonc).toBe(true);
    expect(serializePen(doc, format)).toBe('{\n  "version": "2.21",\n  "children": []\n}');
  });

  test('syntax errors point at a line and column', () => {
    let caught: unknown;
    try {
      parsePen('{\n  "version": "2.21",\n  "children": [\n    {"type": }\n  ]\n}');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PenParseError);
    expect((caught as PenParseError).line).toBe(4);
    expect((caught as PenParseError).message).toContain('line 4');
  });

  test('a non-object document is rejected', () => {
    expect(() => parsePen('[]')).toThrow(PenParseError);
  });
});
