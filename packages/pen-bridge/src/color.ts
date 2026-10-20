import type { Color } from '@open-pencil/scene-graph';

const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA` → color with components in 0..1. */
export function parseHexColor(value: unknown): Color | undefined {
  if (typeof value !== 'string') return undefined;
  const match = HEX_RE.exec(value.trim());
  if (!match) return undefined;
  let hex = match[1] as string;
  if (hex.length <= 4) hex = [...hex].map((c) => c + c).join('');
  const byte = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16) / 255;
  return { r: byte(0), g: byte(2), b: byte(4), a: hex.length === 8 ? byte(6) : 1 };
}

export const mixColors = (colors: readonly Color[]): Color => {
  const n = Math.max(colors.length, 1);
  const sum = colors.reduce(
    (acc, c) => ({ r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b, a: acc.a + c.a }),
    { r: 0, g: 0, b: 0, a: 0 },
  );
  return { r: sum.r / n, g: sum.g / n, b: sum.b / n, a: sum.a / n };
};
