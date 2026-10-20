import type { SceneNode, Stroke, StrokeCap, StrokeJoin } from '@open-pencil/scene-graph';
import { convertFills, type PaintTarget } from './paints.ts';
import type { Scope } from './scope.ts';

type StrokeFields = Pick<
  SceneNode,
  | 'strokes'
  | 'strokeWeight'
  | 'strokeAlign'
  | 'strokeCap'
  | 'strokeJoin'
  | 'independentStrokeWeights'
  | 'borderTopWeight'
  | 'borderRightWeight'
  | 'borderBottomWeight'
  | 'borderLeftWeight'
>;

const ALIGN: Record<string, Stroke['align']> = {
  inner: 'INSIDE',
  center: 'CENTER',
  outer: 'OUTSIDE',
};
const CAP: Record<string, StrokeCap> = { butt: 'NONE', round: 'ROUND', square: 'SQUARE' };
const JOIN: Record<string, StrokeJoin> = { miter: 'MITER', bevel: 'BEVEL', round: 'ROUND' };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `.pen` stroke: `stroke` is a fill or a list of fills; `strokeWidth` is uniform or per side.
 * `defaultAlign` is used when `strokeAlignment` is absent.
 */
export function convertStroke(
  node: Record<string, unknown>,
  scope: Scope,
  target: PaintTarget,
  defaultAlign: Stroke['align'] = 'INSIDE',
): Partial<StrokeFields> {
  if (node.stroke === undefined) return {};
  const paints = convertFills(node.stroke, scope, target);
  if (paints.length === 0) return {};

  const align = ALIGN[scope.str(node.strokeAlignment) ?? ''] ?? defaultAlign;
  const cap = CAP[scope.str(node.strokeLinecap) ?? ''];
  const join = JOIN[scope.str(node.strokeLinejoin) ?? ''];

  const width = node.strokeWidth;
  let weight: number;
  const fields: Partial<StrokeFields> = {};
  if (isObject(width)) {
    const top = scope.num(width.top, 0);
    const right = scope.num(width.right, 0);
    const bottom = scope.num(width.bottom, 0);
    const left = scope.num(width.left, 0);
    weight = Math.max(top, right, bottom, left);
    Object.assign(fields, {
      independentStrokeWeights: true,
      borderTopWeight: top,
      borderRightWeight: right,
      borderBottomWeight: bottom,
      borderLeftWeight: left,
    });
  } else {
    weight = scope.num(width, 1);
  }
  if (weight <= 0) return {};

  const strokes: Stroke[] = paints.map((paint) => ({
    ...paint,
    weight,
    align,
    ...(cap ? { cap } : {}),
    ...(join ? { join } : {}),
  }));
  return {
    ...fields,
    strokes,
    strokeWeight: weight,
    strokeAlign: align,
    ...(cap ? { strokeCap: cap } : {}),
    ...(join ? { strokeJoin: join } : {}),
  };
}
