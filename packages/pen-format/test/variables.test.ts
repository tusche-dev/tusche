import { describe, expect, test } from 'bun:test';
import {
  createVariableResolver,
  defaultTheme,
  type PenDocument,
  resolveValue,
  themeAt,
} from '../src/index.ts';

// Two theme axes, like negolosom/app.pen: { mode, palette }.
const doc = (): PenDocument =>
  ({
    version: '2.21',
    themes: { mode: ['light', 'dark'], palette: ['beige', 'white'] },
    variables: {
      bg: {
        type: 'color',
        value: [
          { value: '#FFFFFF' },
          { value: '#F5F0E6', theme: { palette: 'beige' } },
          { value: '#111111', theme: { mode: 'dark' } },
          { value: '#221E18', theme: { mode: 'dark', palette: 'beige' } },
        ],
      },
      accent: { type: 'color', value: '$brand' },
      brand: {
        type: 'color',
        value: [
          { value: '#0055FF', theme: { mode: 'light' } },
          { value: '#66AAFF', theme: { mode: 'dark' } },
        ],
      },
      gap: { type: 'number', value: 8 },
      loopA: { type: 'number', value: '$loopB' },
      loopB: { type: 'number', value: '$loopA' },
    },
    children: [],
  }) as PenDocument;

describe('themes', () => {
  test('the default theme is the first value of every axis', () => {
    expect(defaultTheme(doc())).toEqual({ mode: 'light', palette: 'beige' });
    expect(defaultTheme({ version: '2.21', children: [] })).toEqual({});
  });

  test('theme on a node overrides only its own axes', () => {
    const root = defaultTheme(doc());
    const dark = themeAt(root, { mode: 'dark' });
    expect(dark).toEqual({ mode: 'dark', palette: 'beige' });
    expect(themeAt(dark, { palette: 'white' })).toEqual({ mode: 'dark', palette: 'white' });
    expect(themeAt(dark, undefined)).toBe(dark);
  });
});

describe('variables', () => {
  test('the last matching entry wins', () => {
    const resolve = createVariableResolver(doc());
    expect(resolve('$bg')).toBe('#F5F0E6');
    expect(resolve('$bg', { mode: 'light', palette: 'white' })).toBe('#FFFFFF');
    expect(resolve('$bg', { mode: 'dark', palette: 'white' })).toBe('#111111');
    expect(resolve('$bg', { mode: 'dark', palette: 'beige' })).toBe('#221E18');
  });

  test('references to other variables follow the active theme', () => {
    const resolve = createVariableResolver(doc());
    expect(resolve('$accent')).toBe('#0055FF');
    expect(resolve('$accent', { mode: 'dark', palette: 'beige' })).toBe('#66AAFF');
  });

  test('with no matching entry the default theme is used', () => {
    expect(resolveValue(doc(), '$brand', { mode: 'sepia' })).toBe('#0055FF');
  });

  test('plain values pass through; unknown and cyclic references are undefined', () => {
    const resolve = createVariableResolver(doc());
    expect(resolve('#ABCDEF')).toBe('#ABCDEF');
    expect(resolve(12)).toBe(12);
    expect(resolve('$gap')).toBe(8);
    expect(resolve('$missing')).toBeUndefined();
    expect(resolve('$loopA')).toBeUndefined();
  });
});
