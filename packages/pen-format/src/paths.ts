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

/** Depth-first search below `root` that does not enter nested instances. */
function findBelow(root: PenExtra, id: string): PenNode | undefined {
  const stack = [...childrenOf(root)].reverse();
  while (stack.length > 0) {
    const node = stack.pop() as PenNode;
    if (!isObject(node)) continue;
    if (node.id === id) return node;
    const children = childrenOf(node);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i] as PenNode);
  }
  return undefined;
}

export interface ResolvedPath {
  /** The node at the path as defined (a component child or a replacement), without overrides. */
  node: PenNode;
  /** Instances crossed on the way, outermost first. */
  instances: RefNode[];
  /** Property overrides that apply to the node, outermost last (later entries win). */
  overrides: PenExtra[];
}

const MAX_DEPTH = 64;

/**
 * Resolves a node inside an instance. `segments` are ids relative to `instance`,
 * e.g. `["ok-button", "label"]`.
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

  if (isRef(component)) {
    // The component is itself an instance: look through it.
    found = resolveInInstance(index, component, [first], depth + 1);
  } else {
    const node = findBelow(component, first);
    if (node) found = { node, instances: [], overrides: [] };
  }
  if (!found) return undefined;

  const own = instance.descendants?.[first];
  if (isObject(own) && typeof own.type === 'string') {
    found = { node: own as PenNode, instances: [], overrides: [] };
  } else if (isObject(own)) {
    found = { ...found, overrides: [...found.overrides, own] };
  }

  if (rest.length === 0) {
    return { ...found, instances: [instance, ...found.instances] };
  }

  const nested = found.node;
  if (!isRef(nested)) return undefined;
  const inner = resolveInInstance(index, nested, rest, depth + 1);
  if (!inner) return undefined;

  // Overrides on the outer instance can reach deep: "ok-button/label".
  const key = joinIdPath(segments);
  const deep = instance.descendants?.[key];
  if (isObject(deep) && typeof deep.type === 'string') {
    return {
      node: deep as PenNode,
      instances: [instance, ...found.instances, ...inner.instances],
      overrides: [],
    };
  }
  return {
    node: inner.node,
    instances: [instance, ...found.instances, ...inner.instances],
    overrides: isObject(deep) ? [...inner.overrides, deep] : inner.overrides,
  };
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
  return resolveInInstance(index, node, rest);
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
