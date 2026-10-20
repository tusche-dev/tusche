import type { PenDocument, PenExtra, PenNode, RefNode } from './types.ts';

/** Separator of id paths into component instances: `instanceId/childId/...`. */
export const PATH_SEPARATOR = '/';

export const splitIdPath = (path: string): string[] => path.split(PATH_SEPARATOR);
export const joinIdPath = (ids: readonly string[]): string => ids.join(PATH_SEPARATOR);

const isObject = (value: unknown): value is PenExtra =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const childrenOf = (node: PenExtra): PenNode[] =>
  Array.isArray(node.children) ? (node.children as PenNode[]) : [];

const isRef = (node: PenExtra): node is RefNode =>
  node.type === 'ref' && typeof node.ref === 'string';

/** Id → node for every node of the document tree (instance contents are not expanded). */
export type NodeIndex = ReadonlyMap<string, PenNode>;

export function indexNodes(doc: PenDocument): Map<string, PenNode> {
  const index = new Map<string, PenNode>();
  const stack: PenNode[] = Array.isArray(doc.children) ? [...doc.children].reverse() : [];
  while (stack.length > 0) {
    const node = stack.pop() as PenNode;
    if (!isObject(node)) continue;
    if (typeof node.id === 'string' && !index.has(node.id)) index.set(node.id, node);
    const children = childrenOf(node);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i] as PenNode);
  }
  return index;
}

export interface ResolvedPath {
  /** The node at the path as defined (a component child or a replacement), without overrides. */
  node: PenNode;
  /** Instances crossed on the way, outermost first. */
  instances: RefNode[];
  /** Property overrides that apply to the node, outermost last (later entries win). */
  overrides: PenExtra[];
  /**
   * The node object lives in the overrides of the outermost instance (a replacement, or a
   * child of a `children` override): it can be edited in place. Otherwise a node inside an
   * instance belongs to a component and is changed through `descendants`.
   */
  inline?: boolean;
}

const MAX_DEPTH = 64;

const descendantsOf = (instance: RefNode): Record<string, unknown> =>
  isObject(instance.descendants) ? instance.descendants : {};

/** Depth-first search through a list of nodes that does not enter nested instances. */
function findIn(nodes: readonly unknown[], id: string): PenNode | undefined {
  const stack = [...nodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (!isObject(node)) continue;
    if (node.id === id) return node as PenNode;
    if (isRef(node)) continue;
    const children = childrenOf(node);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i] as PenNode);
  }
  return undefined;
}

/**
 * Nodes the instance adds itself: its own `children` (they replace the component root's
 * children), children of `children` overrides and contents of replacements.
 */
function findAdded(instance: RefNode, id: string): PenNode | undefined {
  if (Array.isArray(instance.children)) {
    const found = findIn(instance.children, id);
    if (found) return found;
  }
  for (const value of Object.values(descendantsOf(instance))) {
    if (!isObject(value) || !Array.isArray(value.children)) continue;
    const found = findIn(value.children, id);
    if (found) return found;
  }
  return undefined;
}

/** The id a replacement is addressed by: its own, or the key when it has none. */
export const replacementId = (key: string, replacement: PenExtra): string =>
  typeof replacement.id === 'string' ? replacement.id : key;

/** A replacement of this instance (not of a nested one) whose own id is `id`. */
function replacementWithId(instance: RefNode, id: string): PenNode | undefined {
  for (const [key, value] of Object.entries(descendantsOf(instance))) {
    if (key.includes(PATH_SEPARATOR) || !isObject(value) || typeof value.type !== 'string')
      continue;
    if (replacementId(key, value) === id) return value as PenNode;
  }
  return undefined;
}

/** Combines two overrides of the same descendant; `outer` wins (as the projection does). */
function combine(inner: unknown, outer: PenExtra): PenExtra {
  if (typeof outer.type === 'string' || !isObject(inner)) return outer;
  return { ...inner, ...outer };
}

/**
 * A nested instance with the deep overrides of the outer one (`"nested/child"` keys)
 * moved into its own `descendants`, so that they are found like its own overrides.
 */
function withOuterOverrides(nested: RefNode, outer: RefNode, prefix: string): RefNode {
  const start = `${prefix}${PATH_SEPARATOR}`;
  const deep = Object.entries(descendantsOf(outer)).filter(
    ([key, value]) => key.startsWith(start) && isObject(value),
  );
  if (deep.length === 0) return nested;
  const descendants: Record<string, unknown> = { ...descendantsOf(nested) };
  for (const [key, value] of deep) {
    const rest = key.slice(start.length);
    descendants[rest] = combine(descendants[rest], value as PenExtra);
  }
  return { ...nested, descendants } as RefNode;
}

/**
 * Resolves a node inside an instance. `segments` are ids relative to `instance`,
 * e.g. `["ok-button", "label"]`. Within one instance every node is addressed by its own
 * id, whether it comes from the component, a replacement or a `children` override;
 * only nested instances add a segment.
 */
export function resolveInInstance(
  index: NodeIndex,
  instance: RefNode,
  segments: readonly string[],
  depth = 0,
): ResolvedPath | undefined {
  if (segments.length === 0 || depth > MAX_DEPTH) return undefined;
  const component = index.get(instance.ref);
  if (!component) return undefined;

  const [first, ...rest] = segments as [string, ...string[]];
  let found: ResolvedPath | undefined;

  const added = findAdded(instance, first);
  const replacement = replacementWithId(instance, first);
  if (added) {
    found = { node: added, instances: [], overrides: [] };
  } else if (replacement) {
    found = { node: replacement, instances: [], overrides: [] };
  } else if (isRef(component)) {
    // The component is itself an instance: look through it.
    found = resolveInInstance(index, component, [first], depth + 1);
  } else {
    const node = findIn(childrenOf(component), first);
    if (node) found = { node, instances: [], overrides: [] };
  }
  if (!found) return undefined;

  const own = replacement ? undefined : descendantsOf(instance)[first];
  if (isObject(own) && typeof own.type === 'string') {
    // A replacement is addressed by its own id: the key of the node it replaced is gone.
    if (replacementId(first, own) !== first) return undefined;
    found = { node: own as PenNode, instances: [], overrides: [] };
  } else if (isObject(own)) {
    found = { ...found, overrides: [...found.overrides, own] };
  }

  if (rest.length === 0) {
    return { ...found, instances: [instance, ...found.instances] };
  }

  const nested = found.node;
  if (!isRef(nested)) return undefined;
  const inner = resolveInInstance(
    index,
    withOuterOverrides(nested, instance, first),
    rest,
    depth + 1,
  );
  if (!inner) return undefined;
  return {
    node: inner.node,
    instances: [instance, ...found.instances, nested, ...inner.instances.slice(1)],
    overrides: inner.overrides,
  };
}

/** Whether `target` is one of the objects in the overrides or own children of `instance`. */
function ownedBy(instance: RefNode, target: object): boolean {
  const stack: unknown[] = [...Object.values(descendantsOf(instance))];
  if (Array.isArray(instance.children)) stack.push(...instance.children);
  while (stack.length > 0) {
    const item = stack.pop();
    if (!isObject(item)) continue;
    if (item === target) return true;
    if (Array.isArray(item.children)) stack.push(...item.children);
  }
  return false;
}

/**
 * Resolves an id path like `"screen"` or `"saveAlert/okButton/label"`.
 * The first id is looked up in the whole tree; every next id is looked up
 * inside the instance before it.
 */
export function resolveNodePath(
  doc: PenDocument,
  path: string,
  index: NodeIndex = indexNodes(doc),
): ResolvedPath | undefined {
  const [first, ...rest] = splitIdPath(path);
  if (first === undefined || first === '') return undefined;
  const node = index.get(first);
  if (!node) return undefined;
  if (rest.length === 0) return { node, instances: [], overrides: [] };
  if (!isRef(node)) return undefined;
  const resolved = resolveInInstance(index, node, rest);
  if (!resolved) return undefined;
  return { ...resolved, inline: ownedBy(node, resolved.node) };
}

/** The node at a resolved path with all overrides applied (a new object; the document is not changed). */
export function effectiveNode(resolved: ResolvedPath): PenNode {
  if (resolved.overrides.length === 0) return resolved.node;
  return Object.assign({}, resolved.node, ...resolved.overrides) as PenNode;
}

/** Follows `ref` chains to the first non-instance node (the component's root). */
export function componentRoot(index: NodeIndex, node: PenNode): PenNode | undefined {
  let current: PenNode | undefined = node;
  for (let depth = 0; current && isRef(current); depth++) {
    if (depth > MAX_DEPTH) return undefined;
    current = index.get(current.ref);
  }
  return current;
}
