import { type NodeIndex, splitIdPath } from '@tusche/pen-format';

/** A `.pen` node as plain data: the projection only reads it. */
export type PenObject = Record<string, unknown>;

/**
 * Hidden key on a materialized node: the id it has in its instance path.
 * A replacement keeps the id of the node it replaced, so that `instance/child`
 * addresses it the same way `resolveNodePath` does.
 */
export const PATH_ID = Symbol('pathId');
type Materialized = PenObject & { [PATH_ID]?: string };

const isObject = (value: unknown): value is PenObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRef = (node: PenObject): boolean => node.type === 'ref' && typeof node.ref === 'string';

export const pathId = (node: PenObject): string => {
  const own = (node as Materialized)[PATH_ID];
  return own ?? (typeof node.id === 'string' ? node.id : '');
};

/** Keys of a `ref` that describe the instance itself, not overrides of the component root. */
const INSTANCE_KEYS = new Set(['type', 'ref', 'id', 'descendants', 'reusable']);

const childrenOf = (node: PenObject): PenObject[] =>
  Array.isArray(node.children) ? (node.children.filter(isObject) as PenObject[]) : [];

/** Copies a tree: new objects for every node and children list; values are shared. */
function copyTree(node: PenObject): Materialized {
  const copy: Materialized = { ...node };
  const id = (node as Materialized)[PATH_ID];
  if (id !== undefined) copy[PATH_ID] = id;
  if (Array.isArray(node.children)) copy.children = childrenOf(node).map(copyTree);
  return copy;
}

/** Depth-first search below `root` that does not enter nested instances. */
function findBelow(root: PenObject, id: string): { parent: PenObject; index: number } | undefined {
  const stack: PenObject[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as PenObject;
    if (node !== root && isRef(node)) continue;
    const children = Array.isArray(node.children) ? node.children : [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (isObject(child) && pathId(child) === id) return { parent: node, index: i };
    }
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (isObject(child)) stack.push(child);
    }
  }
  return undefined;
}

/** Combines two overrides of the same descendant; `outer` wins. */
function combine(inner: unknown, outer: PenObject): PenObject {
  if (typeof outer.type === 'string' || !isObject(inner)) return outer;
  return { ...inner, ...outer };
}

function applyDescendant(root: Materialized, key: string, value: PenObject): boolean {
  const [first, ...rest] = splitIdPath(key) as [string, ...string[]];
  const found = findBelow(root, first);
  if (!found) return false;
  const children = found.parent.children as PenObject[];
  const target = children[found.index] as Materialized;
  if (rest.length > 0) {
    // Deeper keys go to the nested instance; it applies them after its own.
    if (!isRef(target)) return false;
    const restKey = rest.join('/');
    const descendants = isObject(target.descendants) ? { ...target.descendants } : {};
    descendants[restKey] = combine(descendants[restKey], value);
    children[found.index] = { ...target, descendants };
    return true;
  }
  if (typeof value.type === 'string') {
    const replacement = copyTree(value);
    replacement[PATH_ID] = first;
    children[found.index] = replacement;
  } else {
    const merged: Materialized = { ...target, ...value };
    if (Array.isArray(value.children)) merged.children = childrenOf(value).map(copyTree);
    const id = target[PATH_ID];
    if (id !== undefined) merged[PATH_ID] = id;
    children[found.index] = merged;
  }
  return true;
}

export interface Expansion {
  /** The instance as an ordinary node tree; nested instances are still `ref` nodes. */
  root: PenObject;
  /** `descendants` keys that did not match anything. */
  unresolved: string[];
}

/**
 * Expands one level of an instance: copies the component (through `ref` chains),
 * applies the instance's own properties to the root and its `descendants` overrides
 * and replacements. Returns `undefined` for an unknown or cyclic component.
 */
export function expandInstance(
  index: NodeIndex,
  instance: PenObject,
  depth = 0,
): Expansion | undefined {
  if (depth > 64) return undefined;
  const component = index.get(String(instance.ref)) as PenObject | undefined;
  if (!component || component === instance) return undefined;

  let root: Materialized;
  const unresolved: string[] = [];
  if (isRef(component)) {
    const inner = expandInstance(index, component, depth + 1);
    if (!inner) return undefined;
    root = inner.root as Materialized;
    unresolved.push(...inner.unresolved);
  } else {
    root = copyTree(component);
  }

  for (const [key, value] of Object.entries(instance)) {
    if (INSTANCE_KEYS.has(key)) continue;
    if (key === 'theme' && isObject(value) && isObject(root.theme)) {
      root.theme = { ...root.theme, ...value };
    } else if (key === 'children' && Array.isArray(value)) {
      root.children = childrenOf({ children: value }).map(copyTree);
    } else {
      root[key] = value;
    }
  }
  root.id = instance.id;
  delete root.reusable;
  delete root[PATH_ID];

  if (isObject(instance.descendants)) {
    for (const [key, value] of Object.entries(instance.descendants)) {
      if (!isObject(value)) continue;
      if (!applyDescendant(root, key, value)) unresolved.push(key);
    }
  }
  return { root, unresolved };
}
