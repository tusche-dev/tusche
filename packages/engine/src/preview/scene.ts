// The scene of the preview page, without the DOM: top-level nodes laid out by the server,
// all on one page. Used by the browser canvas and, in tests, by the headless renderer.
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph';
import type { Rect } from '../engine.ts';
import type { RootSnapshot } from '../snapshot-codec.ts';

/** A node as the page shows it. */
export interface NodeInfo {
  /** Pen id, or path inside an instance (`instance/child`). */
  id: string;
  name: string;
  type: string;
  bounds: Rect;
  /** Ancestors from the top-level node down to the parent. */
  ancestors: { id: string; name: string }[];
}

export class PreviewScene {
  readonly graph = new SceneGraph();
  readonly pageId: string;
  private readonly rootNodes = new Map<string, string[]>();

  constructor() {
    const page = this.graph.getPages()[0];
    if (!page) throw new Error('scene graph without a page');
    this.pageId = page.id;
  }

  /** Top-level nodes in paint order. */
  get roots(): string[] {
    return this.page().childIds;
  }

  /** Keeps the top-level nodes of `order` (in that order) and replaces the ones in `roots`. */
  apply(order: readonly string[], roots: readonly RootSnapshot[]): void {
    const keep = new Set(order);
    for (const id of [...this.rootNodes.keys()]) {
      if (!keep.has(id)) this.removeRoot(id);
    }
    for (const root of roots) {
      this.removeRoot(root.id);
      for (const node of root.nodes) this.graph.nodes.set(node.id, node);
      const top = this.graph.nodes.get(root.id);
      if (top) top.parentId = this.pageId;
      this.rootNodes.set(
        root.id,
        root.nodes.map((n) => n.id),
      );
      for (const [hash, bytes] of root.images) this.graph.images.set(hash, bytes);
    }
    this.page().childIds = order.filter((id) => this.rootNodes.has(id));
    this.graph.clearAbsPosCache();
  }

  has(id: string): boolean {
    return this.graph.getNode(id) !== undefined;
  }

  /** The deepest node at a point of the canvas. */
  nodeAt(x: number, y: number): string | null {
    return this.graph.hitTestDeep(x, y, this.pageId)?.id ?? null;
  }

  /** Bounds on the canvas of nodes (all top-level nodes by default). */
  bounds(ids: readonly string[] = this.roots): Rect | undefined {
    let box: Rect | undefined;
    for (const id of ids) {
      if (!this.has(id)) continue;
      const b = this.graph.getAbsoluteBounds(id);
      box = box ? union(box, b) : { x: b.x, y: b.y, width: b.width, height: b.height };
    }
    return box;
  }

  info(id: string): NodeInfo | undefined {
    const node = this.graph.getNode(id);
    if (!node) return undefined;
    const ancestors: NodeInfo['ancestors'] = [];
    for (let p = node.parentId; p && p !== this.pageId; ) {
      const parent: SceneNode | undefined = this.graph.getNode(p);
      if (!parent) break;
      ancestors.unshift({ id: parent.id, name: parent.name });
      p = parent.parentId;
    }
    const b = this.graph.getAbsoluteBounds(id);
    return {
      id: node.id,
      name: node.name,
      type: node.type,
      bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
      ancestors,
    };
  }

  private page(): SceneNode {
    return this.graph.getNode(this.pageId) as SceneNode;
  }

  private removeRoot(id: string): void {
    for (const nodeId of this.rootNodes.get(id) ?? []) this.graph.nodes.delete(nodeId);
    this.rootNodes.delete(id);
  }
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
