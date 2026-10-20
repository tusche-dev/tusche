import type { SceneNode } from '@open-pencil/scene-graph';
import type { Scope } from './scope.ts';

type TextFields = Pick<
  SceneNode,
  | 'text'
  | 'fontFamily'
  | 'fontSize'
  | 'fontWeight'
  | 'italic'
  | 'lineHeight'
  | 'letterSpacing'
  | 'textAlignHorizontal'
  | 'textAlignVertical'
  | 'textDecoration'
>;

export const DEFAULT_FONT_FAMILY = 'Inter';
export const DEFAULT_FONT_SIZE = 14;

const WEIGHTS: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  normal: 400,
  regular: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

export function fontWeight(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 400;
  const numeric = Number.parseInt(value, 10);
  if (Number.isFinite(numeric)) return numeric;
  return WEIGHTS[value.toLowerCase().replace(/[\s_-]/g, '')] ?? 400;
}

const H_ALIGN: Record<string, SceneNode['textAlignHorizontal']> = {
  left: 'LEFT',
  center: 'CENTER',
  right: 'RIGHT',
  justify: 'JUSTIFIED',
};
const V_ALIGN: Record<string, SceneNode['textAlignVertical']> = {
  top: 'TOP',
  middle: 'CENTER',
  bottom: 'BOTTOM',
};

/** Text content: a `$variable` when it names one, otherwise the literal string ("$5" stays "$5"). */
export function textContent(value: unknown, scope: Scope): string {
  const resolved = scope.value(value);
  if (resolved !== undefined && resolved !== null) return String(resolved);
  return typeof value === 'string' ? value : '';
}

/** Text style and content of `text`, `note`, `prompt` and `context` nodes. */
export function textFields(node: Record<string, unknown>, scope: Scope): TextFields {
  const fontSize = scope.num(node.fontSize, DEFAULT_FONT_SIZE);
  const lineHeight = scope.num(node.lineHeight);
  const underline = scope.bool(node.underline, false);
  const strikethrough = scope.bool(node.strikethrough, false);
  return {
    text: textContent(node.content, scope),
    fontFamily: scope.str(node.fontFamily) ?? DEFAULT_FONT_FAMILY,
    fontSize,
    fontWeight: fontWeight(scope.value(node.fontWeight)),
    italic: scope.str(node.fontStyle)?.toLowerCase().includes('italic') ?? false,
    // pen.dev rounds every line to whole pixels: 15 × 1.3 = 19.5 → 20, two lines of 25.5 → 52.
    lineHeight: lineHeight === undefined ? null : Math.round(lineHeight * fontSize),
    letterSpacing: scope.num(node.letterSpacing, 0),
    textAlignHorizontal: H_ALIGN[scope.str(node.textAlign) ?? ''] ?? 'LEFT',
    textAlignVertical: V_ALIGN[scope.str(node.textAlignVertical) ?? ''] ?? 'TOP',
    textDecoration: underline ? 'UNDERLINE' : strikethrough ? 'STRIKETHROUGH' : 'NONE',
  };
}
