import type { Scene } from '@tusche/engine';
import { expandInstance, pathId } from '@tusche/pen-bridge';
import {
  createVariableResolver,
  defaultTheme,
  joinIdPath,
  type PenDocument,
  type PenExtra,
  splitIdPath,
  type ThemeContext,
  themeAt,
  type VariableResolver,
} from '@tusche/pen-format';
import { argumentError, ExecError } from '../errors.ts';
import type { Transaction } from '../transaction.ts';
import { chainTo, childrenOf, isObject } from '../tree.ts';
import { DOCUMENT } from './mutations.ts';

export interface GetOptions {
  depth?: number;
  resolveVariables?: boolean;
  resolveInstances?: boolean;
  includePathGeometry?: boolean;
}

/** One node for the visitor in the VM: its properties and the paths of its children. */
export interface NodeEntry {
  path: string;
  node: Record<string, unknown>;
  /** Paths of the children, or `null` for a node without them. */
  children: string[] | null;
}

const DEFAULT_DEPTH = 2;
const DOCUMENT_DEPTH = 1;

const NOT_FOUND_HINT =
  'ids are case-sensitive; a node inside an instance is addressed as instanceId/childId';

function readOptions(value: unknown, fn: string): GetOptions {
  if (value === undefined || value === null) return {};
  if (!isObject(value)) throw argumentError(`${fn}(): options must be an object`);
  const { depth } = value;
  if (depth !== undefined && (!Number.isInteger(depth) || (depth as number) < 0)) {
    throw argumentError(`${fn}(): depth must be a whole number ≥ 0, got ${JSON.stringify(depth)}`);
  }
  return value as GetOptions;
}

/** The instance prefix of a path: `a/b/c` → `a/b/`; a plain id → ``. */
const prefixOf = (path: string): string => {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at + 1);
};

/**
 * Reads the document of a transaction as agents see it: nodes inside instances are
 * expanded with their overrides, so `inst/child` reads what is rendered. Expansions are
 * cached until the document changes.
 */
export class Reader {
  private doc: PenDocument | undefined;
  private readonly nodes = new Map<string, PenExtra | undefined>();
  private readonly expansions = new Map<string, PenExtra | undefined>();
  private resolver: VariableResolver | undefined;
  /** The scene was updated during the call: it has to go back on rollback. */
  sceneChanged = false;
  /** Font faces the layouts of this call could not find. */
  readonly missingFonts = new Set<string>();

  constructor(
    readonly tx: Transaction,
    readonly scene: Scene | undefined,
  ) {}

  private fresh(): void {
    if (this.doc === this.tx.doc) return;
    this.doc = this.tx.doc;
    this.nodes.clear();
    this.expansions.clear();
    this.resolver = undefined;
  }

  /** The node at a path, with instance overrides applied; `undefined` if there is none. */
  node(path: string): PenExtra | undefined {
    this.fresh();
    if (this.nodes.has(path)) return this.nodes.get(path);
    const segments = splitIdPath(path);
    let found: PenExtra | undefined;
    if (segments.length === 1) {
      found = this.tx.index.get(path);
    } else {
      const root = this.expanded(joinIdPath(segments.slice(0, -1)));
      found = root && findBelow(root, segments.at(-1) as string);
    }
    this.nodes.set(path, found);
    return found;
  }

  /** The instance at `path` as an ordinary tree (one level deep). */
  expanded(path: string): PenExtra | undefined {
    this.fresh();
    if (this.expansions.has(path)) return this.expansions.get(path);
    const instance = this.node(path);
    const root =
      instance?.type === 'ref'
        ? (expandInstance(this.tx.index, instance)?.root as PenExtra)
        : undefined;
    this.expansions.set(path, root);
    return root;
  }

  require(path: unknown, fn: string): { path: string; node: PenExtra } {
    if (typeof path !== 'string' || path === '') {
      throw argumentError(`${fn}(): the path must be a node id or path`);
    }
    if (path.includes('#')) {
      throw argumentError(`${fn}(): "${path}" is not a node path`, 'paths are ids joined with "/"');
    }
    const node = this.node(path);
    if (!node) throw new ExecError(`${fn}(): no node "${path}"`, { hint: NOT_FOUND_HINT });
    return { path, node };
  }

  /** Paths of the children a reader sees: instances show theirs only when resolved. */
  childPaths(path: string, node: PenExtra, resolveInstances: boolean): string[] | null {
    if (node.type === 'ref') {
      if (!resolveInstances) return null;
      const root = this.expanded(path);
      const children = root ? childrenOf(root) : [];
      return children.length > 0 ? children.map((child) => `${path}/${pathId(child)}`) : null;
    }
    const children = childrenOf(node);
    if (children.length === 0) return null;
    const prefix = prefixOf(path);
    return children.map((child) => prefix + pathId(child));
  }

  /** Theme of the node at a path: themes of its ancestors in the tree, then its own. */
  private themeOf(path: string): ThemeContext {
    let theme = defaultTheme(this.tx.doc);
    const top = this.tx.index.get(splitIdPath(path)[0] as string);
    const chain = top ? (chainTo(this.tx.doc, top) ?? []) : [];
    for (const item of chain.slice(1)) theme = themeAt(theme, item.theme);
    return theme;
  }

  private resolve(value: unknown, theme: ThemeContext): unknown {
    this.resolver ??= createVariableResolver(this.tx.doc);
    const resolver = this.resolver;
    const deep = (item: unknown): unknown => {
      if (typeof item === 'string') return item.startsWith('$') ? resolver(item, theme) : item;
      if (Array.isArray(item)) return item.map(deep);
      if (isObject(item))
        return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, deep(v)]));
      return item;
    };
    return deep(value);
  }

  /** Own properties of a node as JSON (without children), shaped by the options. */
  props(
    path: string,
    node: PenExtra,
    options: GetOptions,
    theme?: ThemeContext,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const resolve = options.resolveVariables === true;
    const context = resolve ? (theme ?? this.themeOf(path)) : undefined;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'children') continue;
      if (key === 'geometry' && node.type === 'path' && options.includePathGeometry !== true)
        continue;
      result[key] = context ? this.resolve(value, context) : value;
    }
    if (path.includes('/')) result.path = path;
    return result;
  }

  /** `Get(path, options)`: the node with children down to `depth`, stubs below. */
  get(pathValue: unknown, optionsValue: unknown): Record<string, unknown> {
    const options = readOptions(optionsValue, 'Get');
    const resolveInstances = options.resolveInstances === true;
    if (pathValue === DOCUMENT) {
      const depth = options.depth ?? DOCUMENT_DEPTH;
      return {
        id: DOCUMENT,
        children: this.tx.doc.children.map((child) =>
          depth === 0
            ? this.stub(child.id, child, resolveInstances)
            : this.tree(child.id, child, options, depth - 1),
        ),
      };
    }
    const { path, node } = this.require(pathValue, 'Get');
    return this.tree(path, node, options, options.depth ?? DEFAULT_DEPTH);
  }

  private tree(
    path: string,
    node: PenExtra,
    options: GetOptions,
    depth: number,
  ): Record<string, unknown> {
    const resolveInstances = options.resolveInstances === true;
    const source = node.type === 'ref' && resolveInstances ? (this.expanded(path) ?? node) : node;
    const result = this.props(path, source, options);
    if (source !== node) result.ref = node.ref;
    const children = this.childPaths(path, node, resolveInstances);
    if (children) {
      result.children = children.map((childPath) => {
        const child = this.node(childPath) as PenExtra;
        return depth > 0
          ? this.tree(childPath, child, options, depth - 1)
          : this.stub(childPath, child, resolveInstances);
      });
    }
    return result;
  }

  private stub(path: string, node: PenExtra, resolveInstances: boolean): Record<string, unknown> {
    const stub: Record<string, unknown> = { type: node.type, id: node.id };
    if (path.includes('/')) stub.path = path;
    if (typeof node.name === 'string') stub.name = node.name;
    if (node.type === 'ref') stub.ref = node.ref;
    const children = this.childPaths(path, node, resolveInstances);
    if (children) stub.children = children.length;
    return stub;
  }

  /** Visitor entries for the top-level nodes. */
  roots(optionsValue: unknown): NodeEntry[] {
    const options = readOptions(optionsValue, 'Get');
    return this.tx.doc.children.map((node) => this.entry(node.id, node, options));
  }

  /** Visitor entries for paths the VM asks for (a start node, then children batches). */
  entries(paths: unknown, optionsValue: unknown): NodeEntry[] {
    const options = readOptions(optionsValue, 'Get');
    if (!Array.isArray(paths)) throw argumentError('Get(): expected a list of paths');
    return paths.map((path) => {
      const { node } = this.require(path, 'Get');
      return this.entry(path as string, node, options);
    });
  }

  private entry(path: string, node: PenExtra, options: GetOptions): NodeEntry {
    const resolveInstances = options.resolveInstances === true;
    const source = node.type === 'ref' && resolveInstances ? (this.expanded(path) ?? node) : node;
    const props = this.props(path, source, options);
    if (source !== node) props.ref = node.ref;
    return { path, node: props, children: this.childPaths(path, node, resolveInstances) };
  }

  // ── layout reads ────────────────────────────────────────────

  private requireScene(fn: string): Scene {
    if (!this.scene) throw new Error(`${fn}: no scene`);
    return this.scene;
  }

  /**
   * Brings the scene to the transaction's document and lays out the root of `path`.
   * Returns a promise only when there is work to wait for.
   */
  private prepare(path: string, fn: string): Promise<void> | undefined {
    const scene = this.requireScene(fn);
    const changes = this.tx.takeSceneChanges();
    const root = splitIdPath(path)[0] as string;
    const rootId = scene.projection.rootOf(root);
    if (changes === undefined && (rootId === undefined || scene.isLaidOut(rootId)))
      return undefined;
    return (async () => {
      if (changes !== undefined) {
        this.sceneChanged = true;
        await scene.update(this.tx.doc, changes);
      }
      const id = scene.projection.rootOf(root);
      if (id !== undefined) await this.layout([id]);
    })();
  }

  /** Lays out top-level nodes of the scene, remembering missing fonts. */
  async layout(roots: Iterable<string>): Promise<void> {
    const report = await this.requireScene('layout').layout(roots);
    for (const font of report.missingFonts) this.missingFonts.add(font);
  }

  /** Brings the scene to the transaction's document (after the commit, before rendering). */
  async syncScene(): Promise<void> {
    const changes = this.tx.takeSceneChanges();
    if (changes === undefined) return;
    this.sceneChanged = true;
    await this.requireScene('sync').update(this.tx.doc, changes);
  }

  /** Parent of a node of the tree; `undefined` for top-level nodes and nodes inside instances. */
  parent(path: string): PenExtra | undefined {
    if (path.includes('/')) return undefined;
    const node = this.tx.index.get(path);
    const chain = node ? chainTo(this.tx.doc, node) : undefined;
    return chain && chain.length > 2 ? chain.at(-2) : undefined;
  }

  /** `ctx.bounds`: resolved box in the parent's space. */
  bounds(pathValue: unknown): unknown {
    const { path } = this.require(pathValue, 'Get');
    const read = () => {
      const box = this.requireScene('bounds').boundsSync(path);
      return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
    };
    const waiting = this.prepare(path, 'bounds');
    return waiting ? waiting.then(read) : read();
  }

  /** `ctx.problems`: whether a clipping ancestor cuts the node. */
  problems(pathValue: unknown): unknown {
    const { path } = this.require(pathValue, 'Get');
    const read = () => this.requireScene('problems').clippingSync(path)?.state ?? null;
    const waiting = this.prepare(path, 'problems');
    return waiting ? waiting.then(read) : read();
  }

  /** Box of a top-level node on the canvas: from the document if sized in numbers. */
  private async canvasRect(id: string): Promise<Rect | undefined> {
    const node = this.tx.index.get(id) as PenExtra | undefined;
    if (!node) return undefined;
    const x = typeof node.x === 'number' ? node.x : 0;
    const y = typeof node.y === 'number' ? node.y : 0;
    if (typeof node.width === 'number' && typeof node.height === 'number') {
      return { x, y, width: node.width, height: node.height };
    }
    await this.prepare(id, 'FindEmptySpace');
    const box = this.requireScene('FindEmptySpace').boundsSync(id);
    return box ? box.absolute : { x, y, width: 0, height: 0 };
  }

  /** `FindEmptySpace`: a free spot on the canvas next to a node or to all content. */
  async findEmptySpace(query: unknown): Promise<{ x: number; y: number }> {
    if (!isObject(query))
      throw argumentError(
        'FindEmptySpace(): expected {width, height, direction?, padding?, nodeId?}',
      );
    const { width, height, direction = 'right', padding = 100, nodeId } = query;
    for (const [name, value] of [
      ['width', width],
      ['height', height],
      ['padding', padding],
    ] as const) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw argumentError(`FindEmptySpace(): ${name} must be a number ≥ 0`);
      }
    }
    if (!['top', 'right', 'bottom', 'left'].includes(direction as string)) {
      throw argumentError('FindEmptySpace(): direction must be "top", "right", "bottom" or "left"');
    }
    const rects: Rect[] = [];
    for (const node of this.tx.doc.children) {
      const rect = await this.canvasRect(node.id);
      if (rect) rects.push(rect);
    }
    let anchor: Rect | undefined;
    if (nodeId !== undefined && nodeId !== null) {
      const { path } = this.require(nodeId, 'FindEmptySpace');
      await this.prepare(path, 'FindEmptySpace');
      anchor = this.requireScene('FindEmptySpace').boundsSync(path)?.absolute;
    } else if (rects.length > 0) {
      anchor = union(rects);
    }
    if (!anchor) return { x: 0, y: 0 };
    return place(
      anchor,
      rects,
      width as number,
      height as number,
      direction as Direction,
      padding as number,
    );
  }
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Direction = 'top' | 'right' | 'bottom' | 'left';

function union(rects: readonly Rect[]): Rect {
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const overlaps = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.width + gap &&
  b.x < a.x + a.width + gap &&
  a.y < b.y + b.height + gap &&
  b.y < a.y + a.height + gap;

/** Steps away from `anchor` until the box overlaps nothing (keeping `padding` around it). */
function place(
  anchor: Rect,
  rects: readonly Rect[],
  width: number,
  height: number,
  direction: Direction,
  padding: number,
): { x: number; y: number } {
  const box: Rect = { x: anchor.x, y: anchor.y, width, height };
  if (direction === 'right') box.x = anchor.x + anchor.width + padding;
  if (direction === 'left') box.x = anchor.x - padding - width;
  if (direction === 'bottom') box.y = anchor.y + anchor.height + padding;
  if (direction === 'top') box.y = anchor.y - padding - height;
  for (let guard = 0; guard <= rects.length; guard++) {
    const hit = rects.find((rect) => overlaps(box, rect, padding - 1e-6));
    if (!hit) break;
    if (direction === 'right') box.x = hit.x + hit.width + padding;
    if (direction === 'left') box.x = hit.x - padding - width;
    if (direction === 'bottom') box.y = hit.y + hit.height + padding;
    if (direction === 'top') box.y = hit.y - padding - height;
  }
  return { x: box.x, y: box.y };
}

/** Depth-first search below an expanded instance root, not entering nested instances. */
function findBelow(root: PenExtra, id: string): PenExtra | undefined {
  const stack: PenExtra[] = [...childrenOf(root)].reverse();
  while (stack.length > 0) {
    const node = stack.pop() as PenExtra;
    if (pathId(node) === id) return node;
    if (node.type === 'ref') continue;
    const children = childrenOf(node);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i] as PenExtra);
  }
  return undefined;
}

export function getVariables(tx: Transaction): Record<string, unknown> {
  const result: Record<string, unknown> = { variables: tx.doc.variables ?? {} };
  if (tx.doc.themes) result.themes = tx.doc.themes;
  return result;
}
