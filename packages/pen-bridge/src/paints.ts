import type {
  BlendMode,
  Color,
  Effect,
  Fill,
  GradientStop,
  GradientTransform,
  ImageScaleMode,
  Vector,
} from '@open-pencil/scene-graph';
import {
  ellipticalGradientTransform,
  linearGradientTransform,
} from '@open-pencil/scene-graph/gradient';
import { mixColors, parseHexColor } from './color.ts';
import type { Scope } from './scope.ts';

/** Registers image bytes for a fill URL and returns the image hash. */
export type ImageStore = (url: string, scope: Scope) => string | undefined;

type Obj = Record<string, unknown>;
const isObject = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const asList = (value: unknown): unknown[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

const BLEND_MODES: Record<string, BlendMode> = {
  normal: 'NORMAL',
  darken: 'DARKEN',
  multiply: 'MULTIPLY',
  linearBurn: 'COLOR_BURN',
  colorBurn: 'COLOR_BURN',
  light: 'LIGHTEN',
  screen: 'SCREEN',
  linearDodge: 'COLOR_DODGE',
  colorDodge: 'COLOR_DODGE',
  overlay: 'OVERLAY',
  softLight: 'SOFT_LIGHT',
  hardLight: 'HARD_LIGHT',
  difference: 'DIFFERENCE',
  exclusion: 'EXCLUSION',
  hue: 'HUE',
  saturation: 'SATURATION',
  color: 'COLOR',
  luminosity: 'LUMINOSITY',
};

export function blendMode(value: unknown, scope: Scope): BlendMode | undefined {
  const name = scope.str(value);
  if (name === undefined || name === 'normal') return undefined;
  const mode = BLEND_MODES[name];
  if (mode === undefined) scope.warn('unsupported', `Unknown blend mode "${name}"`);
  if (name === 'linearBurn' || name === 'linearDodge') {
    scope.warn('approximated', `Blend mode "${name}" is drawn as its non-linear variant`);
  }
  return mode;
}

export function color(value: unknown, scope: Scope): Color | undefined {
  return parseHexColor(scope.value(value));
}

/** Placeholder for paints the engine cannot draw yet (shader). */
export const STUB_COLOR: Color = { r: 0.62, g: 0.62, b: 0.62, a: 1 };

const solid = (c: Color, visible = true, mode?: BlendMode): Fill => ({
  type: 'SOLID',
  color: { r: c.r, g: c.g, b: c.b, a: 1 },
  opacity: c.a,
  visible,
  ...(mode ? { blendMode: mode } : {}),
});

function stops(value: unknown, scope: Scope): GradientStop[] {
  const result: GradientStop[] = [];
  for (const stop of asList(value)) {
    if (!isObject(stop)) continue;
    const c = color(stop.color, scope);
    if (!c) continue;
    result.push({ color: c, position: Math.min(1, Math.max(0, scope.num(stop.position, 0))) });
  }
  return result.sort((a, b) => a.position - b.position);
}

/** Rotation in `.pen` is counter-clockwise degrees; 0° points up. Unit square, y down. */
function direction(degrees: number): Vector {
  const rad = (degrees * Math.PI) / 180;
  return { x: -Math.sin(rad), y: -Math.cos(rad) };
}

function gradientTransform(
  kind: string,
  fill: Obj,
  scope: Scope,
  width: number,
  height: number,
): GradientTransform {
  const center = isObject(fill.center) ? fill.center : {};
  const size = isObject(fill.size) ? fill.size : {};
  const c = { x: scope.num(center.x, 0.5), y: scope.num(center.y, 0.5) };
  const sw = scope.num(size.width, 1);
  const sh = scope.num(size.height, 1);
  const rotation = scope.num(fill.rotation, 0);
  if (kind === 'linear') {
    const d = direction(rotation);
    const half = sh / 2;
    return linearGradientTransform(
      { x: c.x - d.x * half, y: c.y - d.y * half },
      { x: c.x + d.x * half, y: c.y + d.y * half },
      Math.max(width, 1e-6),
      Math.max(height, 1e-6),
    );
  }
  const up = direction(rotation);
  const right = { x: -up.y, y: up.x };
  return ellipticalGradientTransform(
    c,
    { x: c.x + (right.x * sw) / 2, y: c.y + (right.y * sw) / 2 },
    { x: c.x - (up.x * sh) / 2, y: c.y - (up.y * sh) / 2 },
  );
}

const IMAGE_MODES: Record<string, ImageScaleMode> = {
  cover: 'FILL',
  fill: 'FILL',
  contain: 'FIT',
  fit: 'FIT',
  stretch: 'CROP',
};

export interface PaintTarget {
  width: number;
  height: number;
  images: ImageStore;
}

/** `.pen` fills (one or a list, bottom to top) → scene paints. */
export function convertFills(value: unknown, scope: Scope, target: PaintTarget): Fill[] {
  const fills: Fill[] = [];
  const list = asList(value);
  for (const item of list) {
    if (!isObject(item)) {
      const c = color(item, scope);
      if (c) fills.push(solid(c));
      else if (item !== undefined)
        scope.warn('unsupported', `Fill ${JSON.stringify(item)} is not a color`);
      continue;
    }
    const visible = scope.bool(item.enabled, true);
    const mode = blendMode(item.blendMode, scope);
    const opacity = scope.num(item.opacity, 1);
    switch (item.type) {
      case 'color': {
        const c = color(item.color, scope);
        if (c) fills.push(solid(c, visible, mode));
        break;
      }
      case 'gradient': {
        const kind = scope.str(item.gradientType) ?? 'linear';
        const gradientStops = stops(item.colors, scope);
        if (gradientStops.length === 0) break;
        fills.push({
          type:
            kind === 'radial'
              ? 'GRADIENT_RADIAL'
              : kind === 'angular'
                ? 'GRADIENT_ANGULAR'
                : 'GRADIENT_LINEAR',
          color: gradientStops[0]?.color ?? { r: 0, g: 0, b: 0, a: 1 },
          opacity,
          visible,
          gradientStops,
          gradientTransform: gradientTransform(kind, item, scope, target.width, target.height),
          ...(mode ? { blendMode: mode } : {}),
        });
        break;
      }
      case 'image': {
        const url = scope.str(item.url);
        const hash = url ? target.images(url, scope) : undefined;
        if (!hash) {
          fills.push(solid({ ...STUB_COLOR, a: 0.5 }, visible));
          break;
        }
        const modeName = scope.str(item.mode) ?? 'cover';
        if (Array.isArray(item.transform)) {
          scope.warn('approximated', 'Image crop transform is not applied yet');
        }
        fills.push({
          type: 'IMAGE',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity,
          visible,
          imageHash: hash,
          imageScaleMode: IMAGE_MODES[modeName] ?? 'FILL',
          ...(mode ? { blendMode: mode } : {}),
        });
        break;
      }
      case 'mesh_gradient': {
        const colors = asList(item.colors)
          .map((c) => color(c, scope))
          .filter((c): c is Color => c !== undefined);
        if (colors.length === 0) break;
        const columns = Math.max(1, scope.num(item.columns, 1));
        const top = mixColors(colors.slice(0, columns));
        const bottom = mixColors(colors.slice(-columns));
        scope.warn('approximated', 'mesh_gradient is drawn as a linear gradient');
        fills.push({
          type: 'GRADIENT_LINEAR',
          color: top,
          opacity,
          visible,
          gradientStops: [
            { color: top, position: 0 },
            { color: bottom, position: 1 },
          ],
          gradientTransform: linearGradientTransform(
            { x: 0.5, y: 0 },
            { x: 0.5, y: 1 },
            Math.max(target.width, 1e-6),
            Math.max(target.height, 1e-6),
          ),
        });
        break;
      }
      case 'shader': {
        scope.warn('stub', `Shader fill "${String(item.url)}" is shown as a placeholder`);
        // A shader layered over other fills is usually texture (noise, grain): skip it.
        // On its own it would leave the shape empty, so show a neutral placeholder.
        if (list.length === 1) fills.push(solid(STUB_COLOR, visible));
        break;
      }
      default:
        scope.warn('unsupported', `Unknown fill type "${String(item.type)}"`);
    }
  }
  return fills;
}

/** `.pen` effects → scene effects. Shader effects are skipped with a warning. */
export function convertEffects(value: unknown, scope: Scope): Effect[] {
  const effects: Effect[] = [];
  for (const item of asList(value)) {
    if (!isObject(item)) continue;
    const visible = scope.bool(item.enabled, true);
    switch (item.type) {
      case 'shadow': {
        const offset = isObject(item.offset) ? item.offset : {};
        const mode = blendMode(item.blendMode, scope);
        effects.push({
          type: scope.str(item.shadowType) === 'inner' ? 'INNER_SHADOW' : 'DROP_SHADOW',
          color: color(item.color, scope) ?? { r: 0, g: 0, b: 0, a: 0.25 },
          offset: { x: scope.num(offset.x, 0), y: scope.num(offset.y, 0) },
          radius: scope.num(item.blur, 0),
          spread: scope.num(item.spread, 0),
          visible,
          ...(mode ? { blendMode: mode } : {}),
        });
        break;
      }
      case 'blur':
      case 'background_blur':
        effects.push({
          type: item.type === 'blur' ? 'LAYER_BLUR' : 'BACKGROUND_BLUR',
          color: { r: 0, g: 0, b: 0, a: 0 },
          offset: { x: 0, y: 0 },
          radius: scope.num(item.radius, 0),
          spread: 0,
          visible,
        });
        break;
      case 'shader':
        scope.warn('stub', `Shader effect "${String(item.url)}" is not applied`);
        break;
      default:
        scope.warn('unsupported', `Unknown effect type "${String(item.type)}"`);
    }
  }
  return effects;
}
