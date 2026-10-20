import { describe, expect, test } from 'bun:test';
import { validatePen } from '@tusche/pen-format';
import { archetypes, getStyle, listStyles, StyleError } from '../src/index.ts';

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

  test('unknown style, parameter or option', async () => {
    await expect(getStyle('nope')).rejects.toThrow('available: quiet-editorial');
    await expect(getStyle('quiet-editorial', { tone: 'x' })).rejects.toBeInstanceOf(StyleError);
    await expect(getStyle('quiet-editorial', { accent: 'pink' })).rejects.toThrow(
      'options: terracotta, ink-blue, olive',
    );
  });
});
