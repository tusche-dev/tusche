/**
 * Key order bookkeeping (ADR-006).
 *
 * Objects read from a file remember their original key order, so they are
 * written back unchanged. Objects created by Tusche get the canonical order
 * from docs/dev/05-pen-format.md §11, and keys added to existing objects are
 * slotted into that order next to their known neighbours.
 */

const ORDER = new WeakMap<object, readonly string[]>();

export const setKeyOrder = (object: object, keys: readonly string[]): void => {
  ORDER.set(object, keys);
};

export const getKeyOrder = (object: object): readonly string[] | undefined => ORDER.get(object);

/** Keys that always come last, in this order. */
const TAIL = ['descendants', 'children'] as const;

/** Canonical key order for nodes: §11 first, then the schema order. */
const NODE_KEY_ORDER = [
  'type',
  'id',
  'name',
  'reusable',
  'ref',
  'x',
  'y',
  'width',
  'height',
  'context',
  'theme',
  'enabled',
  'opacity',
  'rotation',
  'flipX',
  'flipY',
  'layoutPosition',
  'metadata',
  'placeholder',
  'slot',
  'clip',
  'layout',
  'gap',
  'padding',
  'justifyContent',
  'alignItems',
  'layoutIncludeStroke',
  'cornerRadius',
  'fill',
  'stroke',
  'strokeWidth',
  'strokeAlignment',
  'strokeLinecap',
  'strokeLinejoin',
  'effect',
  'geometry',
  'viewBox',
  'fillRule',
  'innerRadius',
  'startAngle',
  'sweepAngle',
  'polygonCount',
  'library',
  'icon',
  'weight',
  'content',
  'textGrowth',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textAlign',
  'textAlignVertical',
  'underline',
  'strikethrough',
  'href',
  'model',
  'scriptUri',
  'inputs',
  'url',
  'deviceId',
  'zoom',
  'scrollX',
  'scrollY',
  ...TAIL,
];

const ROOT_KEY_ORDER = ['version', 'themes', 'imports', 'variables', 'children'];

const NODE_RANK = new Map(NODE_KEY_ORDER.map((key, i) => [key, i]));
const ROOT_RANK = new Map(ROOT_KEY_ORDER.map((key, i) => [key, i]));
const TAIL_SET: ReadonlySet<string> = new Set(TAIL);

export type ObjectKind = 'root' | 'node' | 'other';

const kindOf = (object: Record<string, unknown>, isRoot: boolean): ObjectKind => {
  if (isRoot) return 'root';
  if (typeof object.type === 'string' && 'id' in object) return 'node';
  return 'other';
};

/** Canonical order of `keys` for a new object. */
export function canonicalKeys(keys: readonly string[], kind: ObjectKind): string[] {
  if (kind === 'other') return [...keys];
  const rank = kind === 'root' ? ROOT_RANK : NODE_RANK;
  const known = keys.filter((key) => rank.has(key) && !(kind === 'node' && TAIL_SET.has(key)));
  const unknown = keys.filter((key) => !rank.has(key));
  known.sort((a, b) => (rank.get(a) as number) - (rank.get(b) as number));
  if (kind === 'root') return [...known, ...unknown];
  return [...known, ...unknown, ...TAIL.filter((key) => keys.includes(key))];
}

/** Inserts a new key into an existing order, next to its canonical neighbours. */
function placeKey(order: string[], key: string, kind: ObjectKind): void {
  if (kind === 'other') {
    order.push(key);
    return;
  }
  const rank = kind === 'root' ? ROOT_RANK : NODE_RANK;
  const tailStart = kind === 'node' ? order.findIndex((k) => TAIL_SET.has(k)) : -1;
  const own = rank.get(key);
  if (own !== undefined) {
    const before = order.findIndex((k) => {
      const r = rank.get(k);
      return r !== undefined && r > own;
    });
    if (before !== -1) {
      order.splice(before, 0, key);
      return;
    }
    // Nothing known after it: append (tail keys are known, so they were found above).
    order.push(key);
    return;
  }
  if (tailStart !== -1) order.splice(tailStart, 0, key);
  else order.push(key);
}

/** Keys of `object` in the order they should be written. */
export function orderedKeys(object: Record<string, unknown>, isRoot = false): string[] {
  const present = Object.keys(object);
  const stored = ORDER.get(object);
  const kind = kindOf(object, isRoot);
  if (!stored) return canonicalKeys(present, kind);
  const order = stored.filter((key) => Object.hasOwn(object, key));
  if (order.length === present.length) return order;
  const known = new Set(order);
  for (const key of present) {
    if (!known.has(key)) placeKey(order, key, kind);
  }
  return order;
}

/**
 * Returns a copy of `object` with `patch` applied (`undefined` deletes a key).
 * The copy keeps the original key order; new keys are slotted canonically.
 * Use it for immutable updates so a changed node does not get reordered.
 */
export function withChanges<T extends object>(object: T, patch: Record<string, unknown>): T {
  const source = object as Record<string, unknown>;
  const copy: Record<string, unknown> = { ...source };
  ORDER.set(copy, orderedKeys(source));
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete copy[key];
    else copy[key] = value;
  }
  return copy as T;
}

/** Renames a key in place, keeping its position. */
export function renameKey(object: Record<string, unknown>, from: string, to: string): void {
  if (!Object.hasOwn(object, from) || from === to) return;
  const order = orderedKeys(object).filter((key) => key !== to);
  const value = object[from];
  delete object[from];
  object[to] = value;
  ORDER.set(
    object,
    order.map((key) => (key === from ? to : key)),
  );
}

/** Builds a node object with keys in canonical order. */
export function createNode<T extends { type: string; id: string }>(props: T): T {
  const keys = canonicalKeys(Object.keys(props), 'node');
  const node: Record<string, unknown> = {};
  for (const key of keys) node[key] = (props as Record<string, unknown>)[key];
  ORDER.set(node, keys);
  return node as T;
}
