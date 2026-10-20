import {
  createNode,
  type Diagnostic,
  effectiveNode,
  joinIdPath,
  type PenDocument,
  type PenExtra,
  type PenNode,
  type RefNode,
  type ResolvedPath,
  resolveNodePath,
  splitIdPath,
  type VariableDefinition,
  validateNode,
  validateOverride,
  withChanges,
} from '@tusche/pen-format';
import { argumentError, ExecError } from '../errors.ts';
import type { Transaction } from '../transaction.ts';
import {
  chainTo,
  childrenOf,
  descendantKey,
  instancesOf,
  isContainer,
  isObject,
  replaceAt,
} from '../tree.ts';
import { fromDiagnostics } from '../warnings.ts';

/** The value of the `document` constant in snippets. */
export const DOCUMENT = 'document';

/** Where a path points. */
export type Target =
  | { kind: 'document' }
  /** A node object of the document: in the tree, or inline in the overrides of an instance. */
  | { kind: 'node'; path: string; node: PenNode; chain: PenExtra[]; inInstance: boolean }
  /** A node of a component seen through an instance: changed via `descendants`. */
  | {
      kind: 'descendant';
      path: string;
      instance: RefNode;
      key: string;
      resolved: ResolvedPath;
      node: PenNode;
    };

const NOT_FOUND_HINT =
  'ids are case-sensitive; a node inside an instance is addressed as instanceId/childId';

export function resolveTarget(tx: Transaction, path: unknown, fn: string, what = 'path'): Target {
  if (typeof path !== 'string' || path === '') {
    throw argumentError(`${fn}(): the ${what} must be a node id or path, got ${describe(path)}`);
  }
  if (path === DOCUMENT) return { kind: 'document' };
  if (path.includes('#')) {
    throw argumentError(
      `${fn}(): "${path}" is not a node path`,
      'paths are ids joined with "/"; "#" never appears in them',
    );
  }
  const resolved = resolveNodePath(tx.doc, path, tx.index);
  if (!resolved) {
    throw new ExecError(`${fn}(): no node "${path}"`, { hint: NOT_FOUND_HINT });
  }
  const [first, ...rest] = splitIdPath(path) as [string, ...string[]];
  if (rest.length === 0 || resolved.inline) {
    const chain = chainTo(tx.doc, resolved.node);
    if (!chain) throw new Error(`node "${path}" is resolved but not in the document`);
    return { kind: 'node', path, node: resolved.node, chain, inInstance: rest.length > 0 };
  }
  return {
    kind: 'descendant',
    path,
    instance: tx.index.get(first) as RefNode,
    key: joinIdPath(rest),
    resolved,
    node: effectiveNode(resolved),
  };
}

function describe(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  return JSON.stringify(value) ?? String(value);
}

/** Path of a node created next to (inside) `parentPath`: same instance prefix, own id. */
function pathBeside(parentPath: string | undefined, id: string): string {
  if (parentPath === undefined || parentPath === DOCUMENT) return id;
  const segments = splitIdPath(parentPath);
  if (segments.length === 1) return id;
  return joinIdPath([...segments.slice(0, -1), id]);
}

function requireNode(value: unknown, fn: string): PenExtra {
  if (!isObject(value) || typeof value.type !== 'string') {
    throw argumentError(
      `${fn}(): the node must be an object with a "type", got ${describe(value)}`,
      'for example {type:"frame", name:"Card", width:320, height:"fit_content"}',
    );
  }
  return value;
}

interface Prepared {
  node: PenNode;
  /** Old id (or `undefined` for a node that had none) → new id, for nodes of the tree. */
  ids: Map<string, string>;
}

/**
 * Gives new ids to the node and every node of its subtree (not to the contents of
 * instances, which are addressed by path), records names, and orders keys canonically.
 */
function assignIds(
  tx: Transaction,
  input: PenExtra,
  options: { fn: string; warn: boolean; keepRootId?: string; path?: string },
): Prepared {
  const ids = new Map<string, string>();
  let ignored = 0;
  const visit = (raw: PenExtra, isRoot: boolean): PenNode => {
    const id = isRoot && options.keepRootId !== undefined ? options.keepRootId : tx.newId();
    if (typeof raw.id === 'string') {
      ids.set(raw.id, id);
      if (raw.id !== id) ignored++;
    }
    const props: Record<string, unknown> = { ...raw, id };
    if (Array.isArray(raw.children) && raw.type !== 'ref') {
      props.children = raw.children.map((child) => visit(requireNode(child, options.fn), false));
    }
    if (raw.type === 'ref' && isObject(raw.descendants)) {
      const descendants: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(raw.descendants)) {
        // A replacement needs an id of its own; the path (the key) stays how it is addressed.
        descendants[key] =
          isObject(value) && typeof value.type === 'string' && typeof value.id !== 'string'
            ? { ...value, id: tx.newId() }
            : value;
      }
      props.descendants = descendants;
    }
    const node = createNode(props as PenNode);
    if (typeof node.name === 'string') tx.names.push([node.name, node.id]);
    return node;
  };
  const node = visit(input, true);
  if (options.warn && ignored > 0) {
    tx.warn({
      code: 'id-ignored',
      message:
        ignored === 1
          ? 'An "id" in the input was ignored: Tusche generates ids'
          : `${ignored} "id" values in the input were ignored: Tusche generates ids`,
      path: options.path ?? node.id,
    });
  }
  return { node, ids };
}

const HINTS: Readonly<Record<string, string>> = {
  'layout-on-non-frame': 'wrap the node in a frame and put the layout properties on the frame',
};

/** The first key of a diagnostic path: `$.fill[0]` → `fill`. */
const topKey = (path: string): string | undefined => /^\$\.([^.[]+)/.exec(path)?.[1];

/**
 * Turns validator errors into an exception and keeps its warnings. With `keys`, only
 * problems in those properties count: the rest of the node was there before the call.
 */
function check(
  tx: Transaction,
  diagnostics: readonly Diagnostic[],
  fn: string,
  path: string,
  keys?: ReadonlySet<string>,
): void {
  const relevant = keys
    ? diagnostics.filter((d) => {
        const key = topKey(d.path);
        return key !== undefined && keys.has(key);
      })
    : diagnostics;
  const error = relevant.find((d) => d.level === 'error');
  if (error) {
    const where = error.path === '$' ? '' : ` (at ${error.path.replace(/^\$\.?/, '')})`;
    const hint = HINTS[error.code];
    throw new ExecError(
      `${fn}(): ${error.message}${where}`,
      hint === undefined ? { name: 'TypeError' } : { name: 'TypeError', hint },
    );
  }
  for (const warning of fromDiagnostics(relevant, path)) tx.warn(warning);
}

const checkNode = (
  tx: Transaction,
  node: PenNode,
  fn: string,
  path: string,
  scope?: 'replacement',
) =>
  check(
    tx,
    validateNode(tx.doc, node, { index: tx.index, path: '$', scope: scope ?? 'tree' }),
    fn,
    path,
  );

function touchSubtree(tx: Transaction, node: PenNode, path: string): void {
  tx.touched.add(path);
  const prefix = splitIdPath(path).slice(0, -1);
  const stack: PenExtra[] = [...childrenOf(node)];
  while (stack.length > 0) {
    const item = stack.pop() as PenExtra;
    if (typeof item.id === 'string') tx.touched.add(joinIdPath([...prefix, item.id]));
    if (item.type !== 'ref') stack.push(...childrenOf(item));
  }
}

// ── adding nodes ──────────────────────────────────────────────

/**
 * Puts a prepared node into `parent` at `index` (default: the end) and returns its path.
 * Inside an instance the node goes into the `children` override of the descendant.
 */
function place(tx: Transaction, parent: Target, node: PenNode, fn: string, index?: number): string {
  const insertAt = (list: readonly PenNode[]) => {
    const next = [...list];
    next.splice(index ?? next.length, 0, node);
    return next;
  };
  if (parent.kind === 'document') {
    const doc = withChanges(tx.doc, { children: insertAt(tx.doc.children) });
    tx.apply(doc, [doc, node]);
    return node.id;
  }
  if (!isContainer(parent.node)) {
    throw new ExecError(
      `${fn}(): "${parent.path}" is a ${parent.node.type}; only frames and groups have children`,
      {
        name: 'TypeError',
        hint:
          parent.node.type === 'ref'
            ? 'to add to an instance, insert into one of its frames (instanceId/childId), or Replace it'
            : 'insert into its parent frame, or wrap it in a frame first',
      },
    );
  }
  if (parent.kind === 'node') {
    const updated = withChanges(parent.node, { children: insertAt(childrenOf(parent.node)) });
    tx.apply(replaceAt(parent.chain, updated), parent.chain);
    return pathBeside(parent.path, node.id);
  }
  // A component child seen through an instance: its children become an override.
  const descendants = { ...(parent.instance.descendants ?? {}) };
  const own = descendants[parent.key];
  const current =
    isObject(own) && Array.isArray(own.children)
      ? (own.children as PenNode[])
      : structuredClone(childrenOf(parent.node));
  descendants[parent.key] = { ...(isObject(own) ? own : {}), children: insertAt(current) };
  const chain = chainTo(tx.doc, parent.instance) as PenExtra[];
  tx.apply(replaceAt(chain, withChanges(parent.instance, { descendants })), chain);
  return pathBeside(parent.path, node.id);
}

export function insert(tx: Transaction, parentPath: unknown, input: unknown): string {
  return tx.operation('Insert', () => {
    const parent = resolveTarget(tx, parentPath, 'Insert', 'parent');
    const raw = requireNode(input, 'Insert');
    const { node } = assignIds(tx, raw, { fn: 'Insert', warn: true });
    checkNode(tx, node, 'Insert', node.id);
    const path = place(tx, parent, node, 'Insert');
    touchSubtree(tx, node, path);
    tx.counts.inserted++;
    return path;
  });
}

/** Removes `reusable` from every node of a copied subtree: a copy must not add components. */
function stripReusable(node: PenExtra): PenExtra {
  const { reusable: _, ...rest } = node;
  if (Array.isArray(rest.children) && rest.type !== 'ref') {
    rest.children = rest.children.map((child) => (isObject(child) ? stripReusable(child) : child));
  }
  return rest;
}

function applyCopyDescendants(
  root: PenNode,
  ids: Map<string, string>,
  descendants: Record<string, unknown>,
  tx: Transaction,
): PenNode {
  let result: PenExtra = root;
  for (const [key, value] of Object.entries(descendants)) {
    if (!isObject(value)) throw argumentError(`Copy(): descendants["${key}"] must be an object`);
    const [first, ...rest] = splitIdPath(key) as [string, ...string[]];
    const newId = ids.get(first);
    const found = newId === undefined ? undefined : findById(result, newId);
    if (!found) {
      throw new ExecError(
        `Copy(): descendants["${key}"]: the copied node has no descendant "${first}"`,
        {
          hint: 'keys of descendants are ids of the original nodes',
        },
      );
    }
    let replacement: PenExtra;
    if (rest.length > 0) {
      if (found.node.type !== 'ref') {
        throw new ExecError(`Copy(): descendants["${key}"]: "${first}" is not an instance`);
      }
      const inner = { ...((found.node.descendants as Record<string, unknown>) ?? {}) };
      const restKey = joinIdPath(rest);
      inner[restKey] =
        typeof value.type === 'string' ? value : { ...(inner[restKey] as object), ...value };
      replacement = withChanges(found.node, { descendants: inner });
    } else if (typeof value.type === 'string') {
      replacement = assignIds(tx, value, {
        fn: 'Copy',
        warn: false,
        keepRootId: found.node.id as string,
      }).node;
    } else {
      replacement = withChanges(found.node, nullsToUndefined(value));
    }
    result = found.chain.length === 1 ? replacement : replaceIn(found.chain, replacement);
  }
  return result as PenNode;
}

function findById(root: PenExtra, id: string): { node: PenExtra; chain: PenExtra[] } | undefined {
  const chain: PenExtra[] = [];
  const walk = (node: PenExtra): PenExtra | undefined => {
    chain.push(node);
    if (node.id === id) return node;
    if (node.type !== 'ref') {
      for (const child of childrenOf(node)) {
        const found = walk(child);
        if (found) return found;
      }
    }
    chain.pop();
    return undefined;
  };
  const node = walk(root);
  return node ? { node, chain } : undefined;
}

/** Like `replaceAt`, but the chain starts at a node instead of the document. */
function replaceIn(chain: readonly PenExtra[], replacement: PenExtra): PenExtra {
  let current = replacement;
  for (let i = chain.length - 1; i > 0; i--) {
    const parent = chain[i - 1] as PenExtra;
    const children = [...childrenOf(parent)];
    children[children.indexOf(chain[i] as PenNode)] = current as PenNode;
    current = withChanges(parent, { children });
  }
  return current;
}

const nullsToUndefined = (props: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v === null ? undefined : v]));

export function copy(
  tx: Transaction,
  sourcePath: unknown,
  parentPath: unknown,
  overrides?: unknown,
): string {
  return tx.operation('Copy', () => {
    const source = resolveTarget(tx, sourcePath, 'Copy');
    if (source.kind === 'document')
      throw argumentError('Copy(): the document itself cannot be copied');
    const parent = resolveTarget(tx, parentPath, 'Copy', 'parent');
    if (overrides !== undefined && overrides !== null && !isObject(overrides)) {
      throw argumentError(`Copy(): overrides must be an object, got ${describe(overrides)}`);
    }
    const { descendants, ...props } = (overrides ?? {}) as Record<string, unknown>;
    for (const key of ['id', 'type', 'children']) {
      if (key in props) throw argumentError(`Copy(): "${key}" cannot be overridden in a copy`);
    }
    if (descendants !== undefined && !isObject(descendants)) {
      throw argumentError('Copy(): descendants must be an object of id → properties');
    }

    let node: PenNode;
    if (source.node.reusable === true && source.kind === 'node' && !source.inInstance) {
      // A copy of a component is an instance of it.
      const instance: Record<string, unknown> = {
        type: 'ref',
        id: tx.newId(),
        ref: source.node.id,
      };
      Object.assign(instance, nullsToUndefined(props));
      if (descendants !== undefined) instance.descendants = descendants;
      node = createNode(instance as unknown as PenNode);
      if (typeof node.name === 'string') tx.names.push([node.name, node.id]);
    } else {
      const clone = stripReusable(structuredClone(source.node) as PenExtra);
      const prepared = assignIds(tx, clone, { fn: 'Copy', warn: false });
      node = withChanges(prepared.node, nullsToUndefined(props));
      if (descendants !== undefined)
        node = applyCopyDescendants(node, prepared.ids, descendants, tx);
    }
    checkNode(tx, node, 'Copy', node.id);
    const path = place(tx, parent, node, 'Copy');
    touchSubtree(tx, node, path);
    tx.counts.inserted++;
    return path;
  });
}

// ── changing nodes ────────────────────────────────────────────

const IMMUTABLE: Readonly<Record<string, string>> = {
  id: 'ids are generated by Tusche and never change',
  type: 'use Replace(path, node) to change the type of a node',
  ref: 'use Replace(path, {type:"ref", ref: …}) to swap the component of an instance',
  children: 'use Insert, Move and Delete to change children',
};

export function update(tx: Transaction, path: unknown, props: unknown): void {
  tx.operation('Update', () => {
    const target = resolveTarget(tx, path, 'Update');
    if (target.kind === 'document') {
      throw argumentError(
        'Update(): the document itself has no properties to update',
        'use SetVariables for variables',
      );
    }
    if (!isObject(props))
      throw argumentError(`Update(): props must be an object, got ${describe(props)}`);
    for (const key of Object.keys(props)) {
      const hint = IMMUTABLE[key];
      if (hint !== undefined) throw argumentError(`Update(): "${key}" cannot be changed`, hint);
    }
    const keys = new Set(Object.keys(props));
    const patch = nullsToUndefined(props);

    if (target.kind === 'node') {
      const updated = withChanges(target.node, patch);
      check(
        tx,
        validateNode(tx.doc, updated, { index: tx.index, path: '$' }),
        'Update',
        target.path,
        keys,
      );
      tx.apply(replaceAt(target.chain, updated), target.chain);
    } else {
      const descendants: Record<string, unknown> = { ...(target.instance.descendants ?? {}) };
      const own = descendants[target.key];
      const merged: Record<string, unknown> = { ...(isObject(own) ? own : {}) };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete merged[key];
        else merged[key] = value;
      }
      check(
        tx,
        validateOverride(tx.doc, merged, target.node.type, { index: tx.index, path: '$' }),
        'Update',
        target.path,
        keys,
      );
      if (Object.keys(merged).length > 0) descendants[target.key] = merged;
      else delete descendants[target.key];
      const chain = chainTo(tx.doc, target.instance) as PenExtra[];
      const instance = withChanges(target.instance, {
        descendants: Object.keys(descendants).length > 0 ? descendants : undefined,
      });
      tx.apply(replaceAt(chain, instance), chain);
    }
    tx.touched.add(target.path);
    tx.counts.updated++;
  });
}

export function replace(tx: Transaction, path: unknown, input: unknown): string {
  return tx.operation('Replace', () => {
    const target = resolveTarget(tx, path, 'Replace');
    if (target.kind === 'document')
      throw argumentError('Replace(): the document itself cannot be replaced');
    const raw = requireNode(input, 'Replace');
    // The replacement keeps the id, so paths, refs and descendants keys stay valid.
    const id = splitIdPath(target.path).at(-1) as string;
    const { node } = assignIds(tx, raw, {
      fn: 'Replace',
      warn: true,
      keepRootId: id,
      path: target.path,
    });
    const inInstance = target.kind === 'descendant' || target.inInstance;
    checkNode(tx, node, 'Replace', target.path, inInstance ? 'replacement' : undefined);

    if (target.kind === 'node') {
      tx.apply(replaceAt(target.chain, node), target.chain);
    } else {
      const descendants = { ...(target.instance.descendants ?? {}), [target.key]: node };
      const chain = chainTo(tx.doc, target.instance) as PenExtra[];
      tx.apply(replaceAt(chain, withChanges(target.instance, { descendants })), chain);
    }
    touchSubtree(tx, node, target.path);
    tx.counts.replaced++;
    return target.path;
  });
}

const INSIDE_INSTANCE_HINT = 'to hide a node of an instance, use Update(path, {enabled: false})';

export function move(tx: Transaction, path: unknown, parentPath?: unknown, index?: unknown): void {
  tx.operation('Move', () => {
    const target = resolveTarget(tx, path, 'Move');
    if (target.kind === 'document')
      throw argumentError('Move(): the document itself cannot be moved');
    if (target.kind === 'descendant' || target.inInstance) {
      throw new ExecError(`Move(): "${target.path}" is inside an instance and cannot be moved`, {
        hint: `${INSIDE_INSTANCE_HINT}, or Copy it out of the instance`,
      });
    }
    if (
      index !== undefined &&
      index !== null &&
      (!Number.isInteger(index) || (index as number) < 0)
    ) {
      throw argumentError(`Move(): index must be a whole number ≥ 0, got ${describe(index)}`);
    }
    const oldParent = target.chain.at(-2) as PenExtra;
    const parent =
      parentPath === undefined || parentPath === null
        ? oldParent === tx.doc
          ? ({ kind: 'document' } as const)
          : resolveTarget(tx, (oldParent as PenNode).id, 'Move', 'parent')
        : resolveTarget(tx, parentPath, 'Move', 'parent');
    if (parent.kind === 'descendant' || (parent.kind === 'node' && parent.inInstance)) {
      throw new ExecError(`Move(): cannot move a node into an instance ("${parent.path}")`, {
        hint: 'Copy it into the instance and Delete the original',
      });
    }
    if (
      parent.kind === 'node' &&
      (parent.node === target.node || parent.chain.includes(target.node))
    ) {
      throw argumentError(
        `Move(): "${target.path}" cannot be moved into itself or its own descendant`,
      );
    }
    // Remove first, then find the parent again: it may be a changed ancestor of the node.
    const removed = replaceAt(target.chain, undefined);
    tx.apply(removed, target.chain);
    const destination =
      parent.kind === 'document' ? parent : resolveTarget(tx, parent.path, 'Move', 'parent');
    const size =
      destination.kind === 'document'
        ? tx.doc.children.length
        : childrenOf(destination.node).length;
    if (typeof index === 'number' && index > size) {
      throw argumentError(
        `Move(): index ${index} is past the end (the parent has ${size} children after the move)`,
      );
    }
    place(tx, destination, target.node, 'Move', typeof index === 'number' ? index : undefined);
    tx.touched.add(target.path);
    tx.counts.moved++;
  });
}

export function remove(tx: Transaction, path: unknown): void {
  tx.operation('Delete', () => {
    const target = resolveTarget(tx, path, 'Delete');
    if (target.kind === 'document')
      throw argumentError('Delete(): the document itself cannot be deleted');
    const parent = target.kind === 'node' ? (target.chain.at(-2) as PenExtra) : undefined;
    if (
      target.kind === 'descendant' ||
      (parent && descendantKey(parent, target.node) !== undefined)
    ) {
      throw new ExecError(
        `Delete(): "${target.path}" belongs to a component and cannot be deleted from an instance`,
        {
          hint: INSIDE_INSTANCE_HINT,
        },
      );
    }
    if (target.node.reusable === true) {
      const count = instancesOf(tx.doc, target.node);
      if (count > 0) {
        throw new ExecError(
          `Delete(): "${target.path}" is a component with ${count} instance${count === 1 ? '' : 's'}`,
          { hint: 'delete or Replace its instances first' },
        );
      }
    }
    tx.apply(replaceAt(target.chain, undefined), target.chain);
    tx.counts.deleted++;
  });
}

// ── variables ─────────────────────────────────────────────────

const VARIABLE_TYPES = new Set(['boolean', 'color', 'number', 'string']);

function checkVariable(name: string, def: unknown): VariableDefinition {
  if (!isObject(def) || typeof def.type !== 'string' || !VARIABLE_TYPES.has(def.type)) {
    throw argumentError(
      `SetVariables(): "${name}" must be {type, value} with type boolean, color, number or string`,
      'for example {"color.bg": {type: "color", value: "#FFFFFF"}}',
    );
  }
  if (!('value' in def)) throw argumentError(`SetVariables(): "${name}" has no value`);
  if (name.startsWith('$')) {
    throw argumentError(
      `SetVariables(): "${name}": write the name without "$"; use "$${name.slice(1)}" in properties`,
    );
  }
  return def as VariableDefinition;
}

/** Theme axes and their values used by themed variable values. */
function themeValues(variables: Record<string, VariableDefinition>): Map<string, Set<string>> {
  const axes = new Map<string, Set<string>>();
  for (const def of Object.values(variables)) {
    if (!Array.isArray(def.value)) continue;
    for (const entry of def.value) {
      if (!isObject(entry) || !isObject(entry.theme)) continue;
      for (const [axis, value] of Object.entries(entry.theme)) {
        if (typeof value !== 'string') continue;
        if (!axes.has(axis)) axes.set(axis, new Set());
        axes.get(axis)?.add(value);
      }
    }
  }
  return axes;
}

export function setVariables(tx: Transaction, input: unknown, replaceAll?: unknown): void {
  tx.operation('SetVariables', () => {
    if (!isObject(input))
      throw argumentError(
        `SetVariables(): expected an object of name → {type, value}, got ${describe(input)}`,
      );
    const next: Record<string, VariableDefinition> =
      replaceAll === true ? {} : { ...(tx.doc.variables ?? {}) };
    for (const [name, def] of Object.entries(input)) {
      if (def === null) delete next[name];
      else next[name] = checkVariable(name, def);
    }
    // Themed values may bring new theme values: add them to `themes` so they are valid.
    const themes: Record<string, string[]> = { ...(tx.doc.themes ?? {}) };
    let themesChanged = false;
    for (const [axis, values] of themeValues(next)) {
      const known = themes[axis] ?? [];
      const missing = [...values].filter((value) => !known.includes(value));
      if (missing.length > 0) {
        themes[axis] = [...known, ...missing];
        themesChanged = true;
      }
    }
    const patch: Record<string, unknown> = {
      variables: Object.keys(next).length > 0 ? next : undefined,
    };
    if (themesChanged) patch.themes = themes;
    tx.applyToAll(withChanges(tx.doc, patch) as PenDocument);
    tx.counts.variables++;
  });
}
