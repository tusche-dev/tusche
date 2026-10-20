import {
  collectIds,
  generateId,
  indexNodes,
  type PenDocument,
  type PenExtra,
} from '@tusche/pen-format';
import { ExecError } from './errors.ts';
import { affectedRoots, chainNodes } from './tree.ts';
import type { ExecWarning } from './warnings.ts';

export interface MutationCounts {
  inserted: number;
  updated: number;
  replaced: number;
  moved: number;
  deleted: number;
  /** `SetVariables` calls. */
  variables: number;
}

export const DEFAULT_MAX_OPERATIONS = 2000;

/**
 * The changes of one `execute` call. The snapshot is the committed document itself:
 * every change makes a new document that shares the untouched subtrees, so rolling back
 * is just dropping the transaction (ADR-008).
 */
export class Transaction {
  readonly base: PenDocument;
  readonly counts: MutationCounts = {
    inserted: 0,
    updated: 0,
    replaced: 0,
    moved: 0,
    deleted: 0,
    variables: 0,
  };
  /** `[name, id]` of every named node the call created, in order. */
  readonly names: [string, string][] = [];
  /** Paths of nodes the call created or changed: warnings are checked only for them. */
  readonly touched = new Set<string>();
  readonly warnings: ExecWarning[] = [];

  private current: PenDocument;
  private cachedIndex: ReturnType<typeof indexNodes> | undefined;
  private taken: Set<string> | undefined;
  private operations = 0;
  private readonly changedRoots = new Set<string>();
  private readonly changedComponents = new Set<string>();
  private allRoots = false;
  /** Changes not yet passed to the scene (see {@link takeSceneChanges}). */
  private readonly pendingRoots = new Set<string>();
  private readonly pendingComponents = new Set<string>();
  private pendingAll = false;

  constructor(
    doc: PenDocument,
    private readonly maxOperations = DEFAULT_MAX_OPERATIONS,
  ) {
    this.base = doc;
    this.current = doc;
  }

  get doc(): PenDocument {
    return this.current;
  }

  get changed(): boolean {
    return this.current !== this.base;
  }

  /** Id → node of the current document (rebuilt after a change, on demand). */
  get index(): ReturnType<typeof indexNodes> {
    this.cachedIndex ??= indexNodes(this.current);
    return this.cachedIndex;
  }

  /**
   * Runs one mutation: counts it against the limit and undoes everything it did if it
   * throws, so a snippet that catches the error goes on with a consistent document.
   */
  operation<T>(fn: string, body: () => T): T {
    this.operations++;
    if (this.operations > this.maxOperations) {
      throw new ExecError(`${fn}(): more than ${this.maxOperations} changes in one call`, {
        name: 'RangeError',
        hint: 'split the work into several execute calls',
      });
    }
    const saved = {
      doc: this.current,
      counts: { ...this.counts },
      names: this.names.length,
      touched: new Set(this.touched),
      warnings: this.warnings.length,
      roots: new Set(this.changedRoots),
      components: new Set(this.changedComponents),
      allRoots: this.allRoots,
    };
    try {
      return body();
    } catch (error) {
      this.current = saved.doc;
      this.cachedIndex = undefined;
      Object.assign(this.counts, saved.counts);
      this.names.length = saved.names;
      this.touched.clear();
      for (const path of saved.touched) this.touched.add(path);
      this.warnings.length = saved.warnings;
      this.changedRoots.clear();
      for (const id of saved.roots) this.changedRoots.add(id);
      this.changedComponents.clear();
      for (const id of saved.components) this.changedComponents.add(id);
      this.allRoots = saved.allRoots;
      throw error;
    }
  }

  /** A new id, unique in the document and among the ids handed out in this call. */
  newId(): string {
    this.taken ??= collectIds(this.current);
    return generateId(this.taken);
  }

  /**
   * Replaces the document after a change. `chains` are the objects from the document down
   * to every place that changed (as they were before the change).
   */
  apply(doc: PenDocument, ...chains: readonly (readonly PenExtra[])[]): void {
    this.current = doc;
    this.cachedIndex = undefined;
    for (const chain of chains) {
      const nodes = chainNodes(chain);
      const root = nodes[0];
      if (root) {
        this.changedRoots.add(root.id);
        this.pendingRoots.add(root.id);
      }
      for (const node of nodes) {
        if (node.reusable !== true) continue;
        this.changedComponents.add(node.id);
        this.pendingComponents.add(node.id);
      }
    }
  }

  /** Variables changed: every root may render differently. */
  applyToAll(doc: PenDocument): void {
    this.current = doc;
    this.cachedIndex = undefined;
    this.allRoots = true;
    this.pendingAll = true;
  }

  /** Top-level nodes to lay out again before reading or rendering the current document. */
  dirtyRoots(): Set<string> | 'all' {
    if (this.allRoots) return 'all';
    return affectedRoots(this.current, this.changedRoots, this.changedComponents);
  }

  /**
   * Top-level nodes changed since the last call, for a scene that already shows the
   * document as it was then. `undefined` when nothing changed.
   */
  takeSceneChanges(): Set<string> | 'all' | undefined {
    if (this.pendingAll) {
      this.pendingAll = false;
      this.pendingRoots.clear();
      this.pendingComponents.clear();
      return 'all';
    }
    if (this.pendingRoots.size === 0 && this.pendingComponents.size === 0) return undefined;
    // Roots that were removed count too: the scene has to drop them.
    const roots = affectedRoots(this.current, this.pendingRoots, this.pendingComponents);
    for (const id of this.pendingRoots) roots.add(id);
    this.pendingRoots.clear();
    this.pendingComponents.clear();
    return roots;
  }

  /** Top-level nodes a scene that followed this call must lay out again to show `base`. */
  rollbackRoots(): Set<string> | 'all' {
    if (this.allRoots) return 'all';
    const roots = affectedRoots(this.base, this.changedRoots, this.changedComponents);
    for (const id of this.changedRoots) roots.add(id);
    return roots;
  }

  warn(warning: ExecWarning): void {
    this.warnings.push(warning);
  }
}
