import { type PenDocument, type PenExtra, type PenNode, withChanges } from '@tusche/pen-format';

export const isObject = (value: unknown): value is PenExtra =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const childrenOf = (node: PenExtra): PenNode[] =>
  Array.isArray(node.children) ? (node.children as PenNode[]) : [];

const descendantsOf = (node: PenExtra): Record<string, unknown> =>
  isObject(node.descendants) ? node.descendants : {};

/** Node types that hold `children` an agent may add to. */
export const isContainer = (node: PenExtra): boolean =>
  node.type === 'frame' || node.type === 'group';

/** Objects nested directly in `node`: its children, then overrides and replacements of an instance. */
function* nested(node: PenExtra): Generator<PenExtra> {
  for (const child of childrenOf(node)) if (isObject(child)) yield child;
  if (node.type !== 'ref') return;
  for (const value of Object.values(descendantsOf(node))) if (isObject(value)) yield value;
}

/**
 * The objects from the document down to `target` (found by identity), through children,
 * instance overrides and replacements. `undefined` if the document does not hold it.
 */
export function chainTo(doc: PenDocument, target: object): PenExtra[] | undefined {
  if (target === doc) return [doc];
  const chain: PenExtra[] = [doc];
  const walk = (node: PenExtra): boolean => {
    for (const child of nested(node)) {
      chain.push(child);
      if (child === target || walk(child)) return true;
      chain.pop();
    }
    return false;
  };
  return walk(doc) ? chain : undefined;
}

/** The node objects of a chain (overrides without `type` are skipped). */
export const chainNodes = (chain: readonly PenExtra[]): PenNode[] =>
  chain.slice(1).filter((item): item is PenNode => typeof item.type === 'string');

/** Whether `child` sits in the `descendants` of `parent` (a replacement or an override). */
export function descendantKey(parent: PenExtra, child: object): string | undefined {
  for (const [key, value] of Object.entries(descendantsOf(parent))) {
    if (value === child) return key;
  }
  return undefined;
}

/**
 * Replaces the last object of `chain` with `replacement` (or removes it) and copies every
 * object above it, so the result is a new document that shares all untouched subtrees.
 */
export function replaceAt(
  chain: readonly PenExtra[],
  replacement: PenExtra | undefined,
): PenDocument {
  let current = replacement;
  for (let i = chain.length - 1; i > 0; i--) {
    const child = chain[i] as PenExtra;
    const parent = chain[i - 1] as PenExtra;
    const children = childrenOf(parent);
    const at = children.indexOf(child as PenNode);
    if (at >= 0) {
      const next = [...children];
      if (current === undefined) next.splice(at, 1);
      else next[at] = current as PenNode;
      current = withChanges(parent, { children: next });
      continue;
    }
    const key = descendantKey(parent, child);
    if (key === undefined) throw new Error('replaceAt: the chain is broken');
    const descendants: Record<string, unknown> = { ...descendantsOf(parent) };
    if (current === undefined) delete descendants[key];
    else descendants[key] = current;
    current = withChanges(parent, {
      descendants: Object.keys(descendants).length > 0 ? descendants : undefined,
    });
  }
  return current as PenDocument;
}

/** Every `ref` used in the subtree of `node`, inside instance overrides too. */
function refsIn(node: PenExtra, into: Set<string> = new Set()): Set<string> {
  const stack: PenExtra[] = [node];
  while (stack.length > 0) {
    const item = stack.pop() as PenExtra;
    if (item.type === 'ref' && typeof item.ref === 'string') into.add(item.ref);
    for (const child of nested(item)) stack.push(child);
  }
  return into;
}

/** Reusable nodes of the tree (not inside instances), each with the refs in its subtree. */
function components(doc: PenDocument): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const stack: PenExtra[] = [...doc.children];
  while (stack.length > 0) {
    const node = stack.pop() as PenExtra;
    if (node.reusable === true && typeof node.id === 'string') result.set(node.id, refsIn(node));
    if (node.type !== 'ref') stack.push(...childrenOf(node));
  }
  return result;
}

/**
 * Top-level nodes whose rendering may change: the changed roots, and every root that uses
 * a changed component directly or through other components.
 */
export function affectedRoots(
  doc: PenDocument,
  changedRoots: ReadonlySet<string>,
  changedComponents: ReadonlySet<string>,
): Set<string> {
  const roots = new Set<string>();
  const present = new Set(doc.children.map((node) => node.id));
  for (const id of changedRoots) if (present.has(id)) roots.add(id);
  if (changedComponents.size === 0) return roots;

  const changed = new Set(changedComponents);
  const all = components(doc);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [id, refs] of all) {
      if (changed.has(id)) continue;
      for (const ref of refs) {
        if (changed.has(ref)) {
          changed.add(id);
          grew = true;
          break;
        }
      }
    }
  }
  for (const root of doc.children) {
    if (roots.has(root.id)) continue;
    for (const ref of refsIn(root)) {
      if (changed.has(ref)) {
        roots.add(root.id);
        break;
      }
    }
  }
  return roots;
}

/** How many instances outside the component's own subtree refer to it. */
export function instancesOf(doc: PenDocument, component: PenNode): number {
  let count = 0;
  const stack: PenExtra[] = [...doc.children];
  while (stack.length > 0) {
    const node = stack.pop() as PenExtra;
    if (node === component) continue;
    if (node.type === 'ref' && node.ref === component.id) count++;
    for (const child of nested(node)) stack.push(child);
  }
  return count;
}

const componentIds = (root: PenNode, into: Set<string>): void => {
  const stack: PenExtra[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as PenExtra;
    if (node.reusable === true && typeof node.id === 'string') into.add(node.id);
    if (node.type !== 'ref') stack.push(...childrenOf(node));
  }
};

/**
 * Top-level nodes a scene that shows `from` must project again to show `to` (an undo
 * step or a reload): roots that differ, roots that were added or removed, and roots that
 * use a component from a changed root. `'all'` when document-wide data (variables,
 * themes) differs.
 */
export function rootsBetween(from: PenDocument, to: PenDocument): Set<string> | 'all' {
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  keys.delete('children');
  const a = from as PenExtra;
  const b = to as PenExtra;
  for (const key of keys) if (a[key] !== b[key]) return 'all';

  const before = new Map(from.children.map((node) => [node.id, node]));
  const changed = new Set<string>();
  const components = new Set<string>();
  for (const node of to.children) {
    const old = before.get(node.id);
    before.delete(node.id);
    if (old === node) continue;
    changed.add(node.id);
    componentIds(node, components);
    if (old) componentIds(old, components);
  }
  for (const [id, old] of before) {
    changed.add(id);
    componentIds(old, components);
  }
  const roots = affectedRoots(to, changed, components);
  for (const id of changed) roots.add(id);
  return roots;
}
