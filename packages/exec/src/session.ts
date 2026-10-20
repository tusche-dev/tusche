import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createEngine, type Engine, type EngineOptions, type Scene } from '@tusche/engine';
import {
  CURRENT_VERSION,
  DEFAULT_FORMAT,
  migratePen,
  type PenDocument,
  type PenFormat,
  parsePen,
  serializePen,
} from '@tusche/pen-format';
import { hostOps } from './api/index.ts';
import { DEFAULT_OUTPUT_LIMITS, Outputs } from './api/output.ts';
import { Reader } from './api/reads.ts';
import { applyEdits } from './edits.ts';
import { ExecError } from './errors.ts';
import { writeAtomic } from './file.ts';
import {
  DEFAULT_SANDBOX_LIMITS,
  type Globals,
  runSnippet,
  type SandboxLimits,
  type SnippetError,
} from './sandbox.ts';
import { DEFAULT_MAX_OPERATIONS, type MutationCounts, Transaction } from './transaction.ts';
import { rootsBetween } from './tree.ts';
import { afterCommit, dedupe, type ExecWarning } from './warnings.ts';

export interface ExecLimits extends SandboxLimits {
  /** Changes per call. Default 2000. */
  operations: number;
  /** Screenshots per call. Default 6. */
  screenshots: number;
  /** Characters of `Print` output per call. Default 20 000. */
  printChars: number;
}

export const DEFAULT_LIMITS: Readonly<ExecLimits> = Object.freeze({
  ...DEFAULT_SANDBOX_LIMITS,
  operations: DEFAULT_MAX_OPERATIONS,
  ...DEFAULT_OUTPUT_LIMITS,
});

export interface ExecutorOptions {
  /** A ready engine; otherwise one is created on first use with `engineOptions`. */
  engine?: Engine;
  engineOptions?: EngineOptions;
  limits?: Partial<ExecLimits>;
  /** A folder exports may write to besides the document's own. Default `$TUSCHE_ROOT`. */
  root?: string;
  /**
   * When a change reaches the file: right after the commit (default), or `delayMs` after
   * the last one, so a burst of calls writes once (ADR-009).
   */
  save?: 'immediate' | { delayMs: number };
}

export interface OpenDocumentOptions {
  /** Create an empty document if the file does not exist. */
  create?: boolean;
}

/** What {@link DocumentSession.checkDisk} found. */
export type DiskState = 'same' | 'reloaded' | 'conflict' | 'deleted';

export interface HistoryResult {
  /** Steps actually undone or redone. */
  steps: number;
  /** Steps left to undo and to redo. */
  undo: number;
  redo: number;
  warnings: ExecWarning[];
}

export interface ChangeEvent {
  kind: 'commit' | 'undo' | 'redo' | 'reload';
  session: DocumentSession;
}

/** Undo steps kept per document. */
export const UNDO_DEPTH = 50;

interface Snapshot {
  doc: PenDocument;
  globals: Globals;
}

const hashText = (text: string): string => createHash('sha256').update(text).digest('hex');

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function parseDocument(text: string): { doc: PenDocument; format: PenFormat } {
  const parsed = parsePen(text);
  // Migrated in memory; the file is rewritten only with the first change.
  return { doc: migratePen(parsed.doc).doc, format: parsed.format };
}

export class ConflictError extends ExecError {
  constructor(file: string) {
    super(`${file} changed on disk while this session has unsaved changes`, {
      name: 'ConflictError',
      hint: 'reload the file from disk or save the session over it',
    });
  }
}

export type ExecRequest = { input: string } | { editId: string; edits: unknown };

export interface Screenshot {
  path: string;
  png: Uint8Array;
}

export interface ExecFailure extends SnippetError {
  /** Line of the snippet the error points at. */
  source?: string;
}

export interface ExecResult {
  ok: boolean;
  ms: number;
  counts: MutationCounts;
  /** `[name, id]` of named nodes the call created. */
  names: [string, string][];
  prints: string[];
  warnings: ExecWarning[];
  screenshots: Screenshot[];
  /** Files written by `Export`. */
  exported: string[];
  /**
   * The file was written by this call. With a delayed save a changed document is written
   * later and this is `false` (see {@link DocumentSession.dirty}).
   */
  saved: boolean;
  error?: ExecFailure;
  /** Id to fix the failed snippet with `edits`; absent when there is nothing to fix. */
  editId?: string;
}

/** Failed snippets kept for `edits`, per document. */
const MAX_FAILED = 20;

const emptyCounts = (): MutationCounts => ({
  inserted: 0,
  updated: 0,
  replaced: 0,
  moved: 0,
  deleted: 0,
  variables: 0,
});

/** Opens documents and keeps one session per file. */
export class Executor {
  private enginePromise: Promise<Engine> | undefined;
  private readonly pending = new Map<string, Promise<DocumentSession>>();
  private readonly loaded = new Map<string, DocumentSession>();
  readonly limits: ExecLimits;

  constructor(private readonly options: ExecutorOptions = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    if (options.engine) this.enginePromise = Promise.resolve(options.engine);
  }

  engine(): Promise<Engine> {
    this.enginePromise ??= createEngine(this.options.engineOptions);
    return this.enginePromise;
  }

  /** Opens a `.pen` file (or returns its open session). */
  open(filePath: string, options: OpenDocumentOptions = {}): Promise<DocumentSession> {
    const file = resolve(filePath);
    let session = this.pending.get(file);
    if (!session) {
      session = this.load(file, options);
      this.pending.set(file, session);
      session.then(
        (loaded) => this.loaded.set(file, loaded),
        () => this.pending.delete(file),
      );
    }
    return session;
  }

  /** The open session of a file, if any. */
  session(filePath: string): DocumentSession | undefined {
    return this.loaded.get(resolve(filePath));
  }

  /** Sessions that finished opening, in the order they were opened. */
  sessions(): DocumentSession[] {
    return [...this.loaded.values()];
  }

  /** Writes pending changes and forgets the session; the next `open` reads the file again. */
  async close(filePath: string): Promise<void> {
    const file = resolve(filePath);
    const session = this.loaded.get(file);
    this.pending.delete(file);
    this.loaded.delete(file);
    await session?.close();
  }

  /** Writes the pending changes of every session. Errors are collected, not thrown. */
  async flushAll(): Promise<{ filePath: string; error: Error }[]> {
    const failures: { filePath: string; error: Error }[] = [];
    for (const session of this.loaded.values()) {
      try {
        await session.flush();
      } catch (error) {
        failures.push({ filePath: session.filePath, error: error as Error });
      }
    }
    return failures;
  }

  private async load(file: string, options: OpenDocumentOptions): Promise<DocumentSession> {
    let text = await readText(file);
    if (text === undefined && !options.create) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, open '${file}'`), {
        code: 'ENOENT',
      });
    }
    let doc: PenDocument;
    let format: PenFormat;
    if (text === undefined) {
      doc = { version: CURRENT_VERSION, children: [] };
      format = { ...DEFAULT_FORMAT };
      text = serializePen(doc, format);
      await writeAtomic(file, text);
    } else {
      ({ doc, format } = parseDocument(text));
    }
    const engine = await this.engine();
    const scene = await engine.open(doc, { baseDir: dirname(file) });
    const roots = [dirname(file)];
    const extra = this.options.root ?? process.env.TUSCHE_ROOT;
    if (extra) roots.push(resolve(extra));
    const save = this.options.save;
    return new DocumentSession(file, doc, format, scene, this.limits, roots, {
      diskHash: hashText(text),
      saveDelayMs: save === undefined || save === 'immediate' ? undefined : save.delayMs,
    });
  }
}

export const createExecutor = (options: ExecutorOptions = {}): Executor => new Executor(options);

interface SessionFile {
  /** Hash of the text last read from or written to the file. */
  diskHash: string;
  /** Delay of the write after a change; `undefined` writes right away. */
  saveDelayMs: number | undefined;
}

/**
 * One open document: the committed tree, its scene, global variables of snippets,
 * failed snippets waiting for `edits` and the undo history. Calls run one after another.
 */
export class DocumentSession {
  private globals: Globals = {};
  private readonly failed = new Map<string, string>();
  private nextEdit = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private readonly listeners = new Set<(event: ChangeEvent) => void>();
  private diskHash: string;
  private readonly saveDelayMs: number | undefined;
  private unsaved = false;
  private conflicted = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastSaveError: string | undefined;

  constructor(
    readonly filePath: string,
    private committed: PenDocument,
    private currentFormat: PenFormat,
    readonly scene: Scene,
    private readonly limits: ExecLimits,
    private readonly exportDirs: readonly string[],
    file: SessionFile,
  ) {
    this.diskHash = file.diskHash;
    this.saveDelayMs = file.saveDelayMs;
  }

  get doc(): PenDocument {
    return this.committed;
  }

  get format(): PenFormat {
    return this.currentFormat;
  }

  /** Committed changes not written to the file yet. */
  get dirty(): boolean {
    return this.unsaved;
  }

  /** The file changed on disk while the session had unsaved changes (ADR-009). */
  get conflict(): boolean {
    return this.conflicted;
  }

  /** Why the last write failed, until a write succeeds. */
  get saveError(): string | undefined {
    return this.lastSaveError;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  /** Calls `listener` after every commit, undo, redo and reload. Returns an unsubscribe. */
  onChange(listener: (event: ChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(kind: ChangeEvent['kind']): void {
    for (const listener of this.listeners) {
      try {
        listener({ kind, session: this });
      } catch {
        // A listener must not break the session.
      }
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  execute(request: ExecRequest): Promise<ExecResult> {
    return this.enqueue(() => this.run(request));
  }

  /** Undoes up to `steps` committed changes, with the global variables they changed. */
  undo(steps = 1): Promise<HistoryResult> {
    return this.enqueue(() => this.travel('undo', steps));
  }

  /** Redoes up to `steps` undone changes. */
  redo(steps = 1): Promise<HistoryResult> {
    return this.enqueue(() => this.travel('redo', steps));
  }

  /** Writes pending changes now. With `force`, also over a file that changed on disk. */
  flush(options: { force?: boolean } = {}): Promise<void> {
    return this.enqueue(() => this.persist(options.force === true));
  }

  /**
   * Compares the file on disk with what the session last read or wrote. A changed file is
   * read again when there is nothing unsaved; otherwise it is a conflict.
   */
  checkDisk(): Promise<DiskState> {
    return this.enqueue(async () => {
      const text = await readText(this.filePath);
      if (text !== undefined && hashText(text) === this.diskHash) {
        this.conflicted = false;
        return 'same';
      }
      if (this.unsaved) {
        this.conflicted = true;
        return 'conflict';
      }
      if (text === undefined) return 'deleted';
      await this.replace(text);
      return 'reloaded';
    });
  }

  /** Reads the file again, dropping unsaved changes and the undo history. */
  reload(): Promise<void> {
    return this.enqueue(async () => {
      const text = await readText(this.filePath);
      if (text === undefined) {
        throw Object.assign(
          new Error(`ENOENT: no such file or directory, open '${this.filePath}'`),
          {
            code: 'ENOENT',
          },
        );
      }
      await this.replace(text);
    });
  }

  /** Writes pending changes; called before the session is dropped. */
  close(): Promise<void> {
    this.listeners.clear();
    return this.flush();
  }

  private async replace(text: string): Promise<void> {
    const { doc, format } = parseDocument(text);
    this.cancelTimer();
    const previous = this.committed;
    this.committed = doc;
    this.currentFormat = format;
    this.diskHash = hashText(text);
    this.unsaved = false;
    this.conflicted = false;
    this.lastSaveError = undefined;
    this.undoStack.length = 0;
    this.redoStack = [];
    await this.scene.update(doc, rootsBetween(previous, doc));
    this.emit('reload');
  }

  private cancelTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Writes the committed document if it has unsaved changes. */
  private async persist(force: boolean): Promise<void> {
    this.cancelTimer();
    if (!this.unsaved) return;
    try {
      if (!force) {
        const text = await readText(this.filePath);
        if (text === undefined || hashText(text) !== this.diskHash) {
          this.conflicted = true;
          throw new ConflictError(this.filePath);
        }
      }
      const text = serializePen(this.committed, this.currentFormat);
      await writeAtomic(this.filePath, text);
      this.diskHash = hashText(text);
      this.unsaved = false;
      this.conflicted = false;
      this.lastSaveError = undefined;
    } catch (error) {
      this.lastSaveError = (error as Error).message;
      throw error;
    }
  }

  /**
   * After a change of the committed document: writes it now (returns whether it did) or
   * schedules the write.
   */
  private async changed(warnings: ExecWarning[]): Promise<boolean> {
    this.unsaved = true;
    if (this.saveDelayMs === undefined) {
      try {
        await this.persist(false);
        return true;
      } catch (error) {
        warnings.push({
          code: 'save-failed',
          message: `The change is applied but the file was not written: ${(error as Error).message}`,
        });
        return false;
      }
    }
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush().catch(() => undefined);
    }, this.saveDelayMs);
    return false;
  }

  private async travel(kind: 'undo' | 'redo', steps: number): Promise<HistoryResult> {
    const from = kind === 'undo' ? this.undoStack : this.redoStack;
    const to = kind === 'undo' ? this.redoStack : this.undoStack;
    const start = this.committed;
    let done = 0;
    while (done < steps && from.length > 0) {
      const snapshot = from.pop() as Snapshot;
      to.push({ doc: this.committed, globals: this.globals });
      this.committed = snapshot.doc;
      this.globals = snapshot.globals;
      done++;
    }
    const warnings: ExecWarning[] = [];
    if (done > 0) {
      await this.scene.update(this.committed, rootsBetween(start, this.committed));
      await this.changed(warnings);
      this.emit(kind);
    }
    return { steps: done, undo: this.undoStack.length, redo: this.redoStack.length, warnings };
  }

  private failure(error: ExecFailure, ms: number, editId?: string): ExecResult {
    const result: ExecResult = {
      ok: false,
      ms,
      counts: emptyCounts(),
      names: [],
      prints: [],
      warnings: [],
      screenshots: [],
      exported: [],
      saved: false,
      error,
    };
    if (editId !== undefined) result.editId = editId;
    return result;
  }

  private remember(editId: string, code: string): void {
    this.failed.delete(editId);
    this.failed.set(editId, code);
    while (this.failed.size > MAX_FAILED)
      this.failed.delete(this.failed.keys().next().value as string);
  }

  private async run(request: ExecRequest): Promise<ExecResult> {
    const started = performance.now();
    const ms = () => performance.now() - started;

    let code: string;
    let editId: string | undefined;
    if ('editId' in request) {
      editId = request.editId;
      const failed = this.failed.get(editId);
      if (failed === undefined) {
        return this.failure(
          {
            name: 'EditError',
            message: `no failed snippet with editId "${editId}"`,
            hint: 'send the whole snippet as input; an editId lives until its snippet succeeds',
          },
          ms(),
        );
      }
      try {
        code = applyEdits(failed, request.edits);
      } catch (error) {
        const e = error instanceof ExecError ? error : new ExecError(String(error));
        const failure: ExecFailure = { name: e.name, message: e.message };
        if (e.hint !== undefined) failure.hint = e.hint;
        return this.failure(failure, ms(), editId);
      }
    } else {
      if (typeof request.input !== 'string' || request.input.trim() === '') {
        return this.failure(
          { name: 'TypeError', message: 'input must be a non-empty JavaScript snippet' },
          ms(),
        );
      }
      code = request.input;
    }

    const tx = new Transaction(this.committed, this.limits.operations);
    const reader = new Reader(tx, this.scene);
    const outputs = new Outputs(reader, dirname(this.filePath), this.exportDirs, this.limits);
    const run = await runSnippet({
      code,
      ops: hostOps(tx, reader, outputs),
      globals: this.globals,
      limits: this.limits,
    });

    if (!run.ok) {
      // Roll back: the document stays as it was; a scene that followed the call goes back.
      if (reader.sceneChanged) await this.scene.update(this.committed, tx.rollbackRoots());
      editId ??= `e${this.nextEdit++}`;
      this.remember(editId, code);
      const error: ExecFailure = { ...run.error };
      if (error.line !== undefined) {
        const source = code.split('\n')[error.line - 1]?.trim();
        if (source) error.source = source;
      }
      return this.failure(error, ms(), editId);
    }

    // Commit.
    if (tx.changed) {
      this.undoStack.push({ doc: this.committed, globals: this.globals });
      if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
      this.redoStack = [];
    }
    this.committed = tx.doc;
    this.globals = run.globals;
    if (editId !== undefined) this.failed.delete(editId);
    const warnings: ExecWarning[] = [...tx.warnings];
    for (const name of run.dropped) {
      warnings.push({
        code: 'global-not-saved',
        message: `Global "${name}" was not kept for the next call: only JSON values are saved`,
      });
    }

    const saved = tx.changed ? await this.changed(warnings) : false;

    await reader.syncScene();
    if (tx.touched.size > 0) {
      const roots = new Set<string>();
      for (const path of tx.touched) {
        const root = this.scene.projection.rootOf(path);
        if (root !== undefined) roots.add(root);
      }
      await reader.layout(roots);
      warnings.push(
        ...afterCommit(
          { node: (p) => reader.node(p), parent: (p) => reader.parent(p), scene: this.scene },
          tx.touched,
          reader.missingFonts,
        ),
      );
    } else {
      for (const font of reader.missingFonts) {
        warnings.push({
          code: 'unknown-font',
          message: `Font "${font}" was not found; a fallback was used`,
        });
      }
    }

    const screenshots: Screenshot[] = [];
    for (const job of outputs.screenshots) {
      const png = await this.scene.render([job.path], { scale: job.scale, maxSide: 1600 });
      if (png) screenshots.push({ path: job.path, png });
      else
        warnings.push({
          code: 'empty-screenshot',
          message: `Nothing to show for "${job.path}"`,
          path: job.path,
        });
    }
    const exported: string[] = [];
    for (const job of outputs.exports) {
      try {
        const data = await this.scene.export(
          job.paths,
          job.format,
          job.scale === undefined ? {} : { scale: job.scale },
        );
        if (!data) throw new Error('nothing to export');
        await writeAtomic(job.file, data);
        exported.push(job.file);
      } catch (error) {
        warnings.push({
          code: 'export-failed',
          message: `${job.file}: ${(error as Error).message}`,
        });
      }
    }

    if (tx.changed) this.emit('commit');
    return {
      ok: true,
      ms: ms(),
      counts: tx.counts,
      names: tx.names,
      prints: outputs.prints,
      warnings: dedupe(warnings),
      screenshots,
      exported,
      saved,
    };
  }
}
