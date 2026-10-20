import * as v from 'valibot';
import { effects, fills, strokeWidth } from './graphics.ts';
import {
  booleanOrVar,
  cornerRadius,
  numberOrVar,
  padding,
  sizeValue,
  stringOrVar,
  themeSelection,
} from './primitives.ts';

// Children and instance overrides are validated node by node by the validator,
// so here they are only checked for shape.
const childList = v.array(v.looseObject({}), 'Expected "children" to be an array of nodes');

const entity = {
  id: v.pipe(v.string('Expected "id" to be a string'), v.nonEmpty('Expected a non-empty "id"')),
  name: v.optional(v.string()),
  context: v.optional(v.string()),
  reusable: v.optional(v.boolean()),
  theme: v.optional(themeSelection),
  enabled: v.optional(booleanOrVar),
  opacity: v.optional(numberOrVar),
  flipX: v.optional(booleanOrVar),
  flipY: v.optional(booleanOrVar),
  layoutPosition: v.optional(v.picklist(['auto', 'absolute'])),
  metadata: v.optional(v.looseObject({ type: v.string() })),
  rotation: v.optional(numberOrVar),
  x: v.optional(v.number()),
  y: v.optional(v.number()),
};

const size = {
  width: v.optional(sizeValue),
  height: v.optional(sizeValue),
};

const stroke = {
  stroke: v.optional(fills),
  strokeWidth: v.optional(strokeWidth),
  strokeLinecap: v.optional(v.picklist(['butt', 'round', 'square'])),
  strokeLinejoin: v.optional(v.picklist(['miter', 'bevel', 'round'])),
  strokeAlignment: v.optional(v.picklist(['inner', 'center', 'outer'])),
};

const graphics = {
  fill: v.optional(fills),
  ...stroke,
  effect: v.optional(effects),
};

const textStyle = {
  fontFamily: v.optional(stringOrVar),
  fontSize: v.optional(numberOrVar),
  fontWeight: v.optional(stringOrVar),
  fontStyle: v.optional(stringOrVar),
  letterSpacing: v.optional(numberOrVar),
  lineHeight: v.optional(numberOrVar),
  textAlign: v.optional(v.picklist(['left', 'center', 'right', 'justify'])),
  textAlignVertical: v.optional(v.picklist(['top', 'middle', 'bottom'])),
  underline: v.optional(booleanOrVar),
  strikethrough: v.optional(booleanOrVar),
  href: v.optional(v.string()),
};

/** Flex-layout properties: only frames (and instances of frames) may set them. */
export const layoutEntries = {
  layout: v.optional(v.picklist(['none', 'horizontal', 'vertical'])),
  gap: v.optional(numberOrVar),
  padding: v.optional(padding),
  justifyContent: v.optional(
    v.picklist(['start', 'center', 'end', 'space_between', 'space_around']),
  ),
  alignItems: v.optional(v.picklist(['start', 'center', 'end'])),
  layoutIncludeStroke: v.optional(v.boolean()),
};

export const LAYOUT_KEYS: ReadonlySet<string> = new Set(Object.keys(layoutEntries));

const nodeEntries = {
  frame: {
    type: v.literal('frame'),
    ...entity,
    ...size,
    ...graphics,
    cornerRadius: v.optional(cornerRadius),
    clip: v.optional(booleanOrVar),
    placeholder: v.optional(v.boolean()),
    slot: v.optional(v.union([v.literal(false), v.array(v.string())])),
    ...layoutEntries,
    children: v.optional(childList),
  },
  group: {
    type: v.literal('group'),
    ...entity,
    effect: v.optional(effects),
    children: v.optional(childList),
  },
  rectangle: {
    type: v.literal('rectangle'),
    ...entity,
    ...size,
    ...graphics,
    cornerRadius: v.optional(cornerRadius),
  },
  ellipse: {
    type: v.literal('ellipse'),
    ...entity,
    ...size,
    ...graphics,
    innerRadius: v.optional(numberOrVar),
    startAngle: v.optional(numberOrVar),
    sweepAngle: v.optional(numberOrVar),
  },
  polygon: {
    type: v.literal('polygon'),
    ...entity,
    ...size,
    ...graphics,
    polygonCount: v.optional(numberOrVar),
    cornerRadius: v.optional(numberOrVar),
  },
  path: {
    type: v.literal('path'),
    ...entity,
    ...size,
    ...graphics,
    geometry: v.optional(v.string()),
    viewBox: v.optional(v.tuple([v.number(), v.number(), v.number(), v.number()])),
    fillRule: v.optional(v.picklist(['nonzero', 'evenodd'])),
  },
  text: {
    type: v.literal('text'),
    ...entity,
    ...size,
    ...graphics,
    ...textStyle,
    content: v.optional(stringOrVar),
    textGrowth: v.optional(v.picklist(['auto', 'fixed-width', 'fixed-width-height'])),
  },
  icon: {
    type: v.literal('icon'),
    ...entity,
    ...size,
    library: v.optional(stringOrVar),
    icon: v.optional(stringOrVar),
    weight: v.optional(numberOrVar),
    fill: v.optional(fills),
    effect: v.optional(effects),
  },
  note: {
    type: v.literal('note'),
    ...entity,
    ...size,
    ...textStyle,
    content: v.optional(stringOrVar),
  },
  prompt: {
    type: v.literal('prompt'),
    ...entity,
    ...size,
    ...textStyle,
    content: v.optional(stringOrVar),
    model: v.optional(stringOrVar),
  },
  context: {
    type: v.literal('context'),
    ...entity,
    ...size,
    ...textStyle,
    content: v.optional(stringOrVar),
  },
  script: {
    type: v.literal('script'),
    ...entity,
    ...size,
    clip: v.optional(booleanOrVar),
    scriptUri: v.optional(v.string()),
    inputs: v.optional(v.record(v.string(), v.union([v.string(), v.number(), v.boolean()]))),
  },
  browser: {
    type: v.literal('browser'),
    ...entity,
    ...size,
    ...stroke,
    effect: v.optional(effects),
    url: v.optional(v.string()),
    deviceId: v.optional(v.string()),
    zoom: v.optional(v.number()),
    scrollX: v.optional(v.number()),
    scrollY: v.optional(v.number()),
    cornerRadius: v.optional(cornerRadius),
  },
  ref: {
    type: v.literal('ref'),
    ...entity,
    ref: v.pipe(v.string('Expected "ref" to be the id of a reusable node'), v.nonEmpty()),
    descendants: v.optional(v.record(v.string(), v.looseObject({}))),
  },
} as const;

export type KnownNodeType = keyof typeof nodeEntries;

type Entries = (typeof nodeEntries)[KnownNodeType];

const build = (entries: Entries) => v.looseObject(entries);

/** Full node schema per known type. Unknown keys pass through. */
export const NODE_SCHEMAS = Object.fromEntries(
  Object.entries(nodeEntries).map(([type, entries]) => [type, build(entries)]),
) as unknown as Record<KnownNodeType, v.GenericSchema>;

/**
 * The same schemas with every key optional: used for instance overrides,
 * which only list the properties they change.
 */
export const OVERRIDE_SCHEMAS = Object.fromEntries(
  Object.entries(nodeEntries).map(([type, entries]) => [type, v.partial(build(entries))]),
) as unknown as Record<KnownNodeType, v.GenericSchema>;

/** Keys the schema knows for each node type. */
export const KNOWN_KEYS = Object.fromEntries(
  Object.entries(nodeEntries).map(([type, entries]) => [type, new Set(Object.keys(entries))]),
) as unknown as Record<KnownNodeType, ReadonlySet<string>>;

export const isKnownNodeType = (type: unknown): type is KnownNodeType =>
  typeof type === 'string' && Object.hasOwn(nodeEntries, type);
