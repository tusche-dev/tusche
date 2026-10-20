import { describe, expect, test } from 'bun:test';
import { validatePen } from '@tusche/pen-format';
import { type Archetype, archetypes, getStyle, listStyles, StyleError } from '../src/index.ts';

/** Every combination of parameter values. */
function combinations(params: NonNullable<Archetype['params']>): Record<string, string>[] {
  let result: Record<string, string>[] = [{}];
  for (const [param, def] of Object.entries(params)) {
    result = result.flatMap((combo) =>
      Object.keys(def.options).map((option) => ({ ...combo, [param]: option })),
    );
  }
  return result;
}

/** WCAG 2 contrast ratio of two `#RRGGBB` colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const n = Number.parseInt(hex.slice(1, 7), 16);
    const [r, g, bl] = [n >> 16, (n >> 8) & 255, n & 255].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('styles', () => {
  test('every archetype is valid and listed', async () => {
    const all = await archetypes();
    expect(all.size).toBeGreaterThan(0);
    const list = await listStyles();
    expect(list.map((s) => s.name)).toEqual([...all.keys()]);
    expect(list.find((s) => s.name === 'quiet-editorial')).toMatchObject({
      params: { accent: ['terracotta', 'ink-blue', 'olive'] },
    });
  });

  test('parameters fill the palette; variables are a valid SetVariables payload', async () => {
    const plain = await getStyle('quiet-editorial');
    expect(plain.params).toEqual({ accent: 'terracotta' });
    expect(plain.palette.accent).toBe('#B4532F');
    const blue = await getStyle('quiet-editorial', { accent: 'ink-blue' });
    expect(blue.palette.accent).toBe('#2C4A7A');
    expect(blue.variables['color-accent']).toEqual({ type: 'color', value: '#2C4A7A' });
    expect(blue.variables['font-display']).toEqual({ type: 'string', value: 'Lora' });
    expect(blue.variables['space-1']).toEqual({ type: 'number', value: 4 });
    for (const name of (await archetypes()).keys()) {
      const { variables } = await getStyle(name);
      const issues = validatePen({ version: '2.21', variables, children: [] });
      expect(issues.filter((d) => d.level !== 'info')).toEqual([]);
    }
  });

  test('eight archetypes; text and accents are readable with every parameter value', async () => {
    const all = await archetypes();
    expect(all.size).toBe(8);
    const pairs: [string, string][] = [
      ['text', 'bg'],
      ['text', 'surface'],
      ['muted', 'bg'],
      ['muted', 'surface'],
      ['on-accent', 'accent'],
    ];
    const failures: string[] = [];
    for (const [name, archetype] of all) {
      for (const params of combinations(archetype.params ?? {})) {
        const { palette } = await getStyle(name, params);
        for (const [fg, bg] of pairs) {
          const ratio = contrast(palette[fg] as string, palette[bg] as string);
          if (ratio < 4.5) {
            failures.push(`${name} ${JSON.stringify(params)} ${fg}/${bg} ${ratio.toFixed(2)}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test('unknown style, parameter or option', async () => {
    await expect(getStyle('nope')).rejects.toThrow(
      'available: bento-grid, blueprint, mono-minimal, night-shift, quiet-editorial',
    );
    await expect(getStyle('quiet-editorial', { tone: 'x' })).rejects.toBeInstanceOf(StyleError);
    await expect(getStyle('quiet-editorial', { accent: 'pink' })).rejects.toThrow(
      'options: terracotta, ink-blue, olive',
    );
  });
});
