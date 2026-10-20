import { describe, expect, test } from 'bun:test';
import {
  CURRENT_VERSION,
  compareVersions,
  hasErrors,
  MIGRATIONS,
  migratePen,
  type PenDocument,
  parsePen,
  serializePen,
  validatePen,
} from '../src/index.ts';

describe('versions', () => {
  test('compare by number, not as strings', () => {
    expect(compareVersions('2.6', '2.17')).toBeLessThan(0);
    expect(compareVersions('2.21', '2.21')).toBe(0);
    expect(compareVersions('3.0', '2.21')).toBeGreaterThan(0);
    expect(() => compareVersions('2.x', '2.1')).toThrow('Invalid .pen version');
  });

  test('every migration targets a version up to the current one', () => {
    for (const migration of MIGRATIONS) {
      expect(compareVersions(migration.before, CURRENT_VERSION)).toBeLessThanOrEqual(0);
    }
  });
});

describe('migratePen', () => {
  test('icon_font becomes icon, keeping key positions', () => {
    const raw =
      '{"version":"2.6","children":[{"type":"icon_font","id":"i","iconFontName":"home","iconFontFamily":"lucide","width":24,"height":24,"fill":"#000000"}]}';
    const { doc, format } = parsePen(raw);
    const result = migratePen(doc);
    expect(result.applied).toEqual(['icon-font-to-icon']);
    expect(result.diagnostics).toMatchObject([
      { level: 'info', code: 'migration', path: '$.children[0]' },
    ]);
    expect(serializePen(doc, format)).toBe(
      '{"version":"2.21","children":[{"type":"icon","id":"i","icon":"home","library":"lucide","width":24,"height":24,"fill":"#000000"}]}',
    );
    expect(hasErrors(validatePen(doc))).toBe(false);
  });

  test('old image fill modes are renamed (fills and strokes, single and lists)', () => {
    const doc = {
      version: '2.18',
      children: [
        { type: 'rectangle', id: 'a', fill: { type: 'image', url: 'a.png', mode: 'fill' } },
        {
          type: 'rectangle',
          id: 'b',
          stroke: ['#000000', { type: 'image', url: 'b.png', mode: 'fit' }],
        },
        { type: 'rectangle', id: 'c', fill: { type: 'image', url: 'c.png', mode: 'stretch' } },
      ],
    } as PenDocument;
    expect(hasErrors(validatePen(doc))).toBe(true);
    const result = migratePen(doc);
    expect(result.applied).toEqual(['image-fill-mode']);
    expect(result.diagnostics.map((d) => d.path)).toEqual([
      '$.children[0].fill.mode',
      '$.children[1].stroke[1].mode',
    ]);
    expect(hasErrors(validatePen(doc))).toBe(false);
  });

  test('current documents are left alone', () => {
    const doc = {
      version: CURRENT_VERSION,
      children: [{ type: 'icon_font', id: 'x' }],
    } as unknown as PenDocument;
    expect(migratePen(doc)).toMatchObject({
      applied: [],
      from: '2.21',
      to: '2.21',
      diagnostics: [],
    });
    expect((doc.children[0] as { type: string }).type).toBe('icon_font');
  });

  test('newer and broken versions are not touched', () => {
    for (const version of ['2.40', '3.0', 'banana']) {
      const doc = { version, children: [] } as PenDocument;
      const result = migratePen(doc);
      expect(doc.version).toBe(version);
      expect(result.applied).toEqual([]);
    }
    expect(migratePen({ version: '3.0', children: [] } as PenDocument).diagnostics).toMatchObject([
      { level: 'warning', code: 'migration' },
    ]);
  });
});
