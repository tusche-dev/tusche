import * as v from 'valibot';
import { blendMode, booleanOrVar, colorOrVar, numberOrVar } from './primitives.ts';

const fillBase = {
  enabled: v.optional(booleanOrVar),
  blendMode: v.optional(blendMode),
};

const point = v.tuple([v.number(), v.number()]);

const shaderUniforms = v.record(
  v.string(),
  v.union([v.number(), v.boolean(), v.string(), v.array(v.number())]),
);

export const fillObject = v.variant(
  'type',
  [
    v.looseObject({ type: v.literal('color'), ...fillBase, color: colorOrVar }),
    v.looseObject({
      type: v.literal('gradient'),
      ...fillBase,
      gradientType: v.optional(v.picklist(['linear', 'radial', 'angular'])),
      opacity: v.optional(numberOrVar),
      center: v.optional(v.looseObject({ x: v.optional(v.number()), y: v.optional(v.number()) })),
      size: v.optional(
        v.looseObject({ width: v.optional(numberOrVar), height: v.optional(numberOrVar) }),
      ),
      rotation: v.optional(numberOrVar),
      colors: v.optional(v.array(v.looseObject({ color: colorOrVar, position: numberOrVar }))),
    }),
    v.looseObject({
      type: v.literal('image'),
      ...fillBase,
      opacity: v.optional(numberOrVar),
      url: v.optional(v.string()),
      mode: v.optional(v.picklist(['cover', 'contain', 'stretch'])),
      transform: v.optional(
        v.tuple([v.number(), v.number(), v.number(), v.number(), v.number(), v.number()]),
      ),
    }),
    v.looseObject({
      type: v.literal('shader'),
      ...fillBase,
      opacity: v.optional(numberOrVar),
      url: v.string(),
      uniforms: v.optional(shaderUniforms),
    }),
    v.looseObject({
      type: v.literal('mesh_gradient'),
      ...fillBase,
      opacity: v.optional(numberOrVar),
      columns: v.optional(v.number()),
      rows: v.optional(v.number()),
      colors: v.optional(v.array(colorOrVar)),
      points: v.optional(
        v.array(
          v.union([
            point,
            v.looseObject({
              position: point,
              leftHandle: v.optional(point),
              rightHandle: v.optional(point),
              topHandle: v.optional(point),
              bottomHandle: v.optional(point),
            }),
          ]),
        ),
      ),
    }),
  ],
  'Unknown fill type; expected color, gradient, image, shader or mesh_gradient',
);

export const fill = v.union([colorOrVar, fillObject]);
export const fills = v.union([fill, v.array(fill)]);

export const effect = v.variant(
  'type',
  [
    v.looseObject({
      type: v.picklist(['blur', 'background_blur']),
      enabled: v.optional(booleanOrVar),
      radius: v.optional(numberOrVar),
    }),
    v.looseObject({
      type: v.literal('shadow'),
      enabled: v.optional(booleanOrVar),
      shadowType: v.optional(v.picklist(['inner', 'outer'])),
      offset: v.optional(v.looseObject({ x: numberOrVar, y: numberOrVar })),
      blur: v.optional(numberOrVar),
      color: v.optional(colorOrVar),
      blendMode: v.optional(blendMode),
    }),
    v.looseObject({
      type: v.literal('shader'),
      enabled: v.optional(booleanOrVar),
      url: v.string(),
      uniforms: v.optional(shaderUniforms),
    }),
  ],
  'Unknown effect type; expected blur, background_blur, shadow or shader',
);
export const effects = v.union([effect, v.array(effect)]);

export const strokeWidth = v.union([
  numberOrVar,
  v.looseObject({
    top: v.optional(numberOrVar),
    right: v.optional(numberOrVar),
    bottom: v.optional(numberOrVar),
    left: v.optional(numberOrVar),
  }),
]);
