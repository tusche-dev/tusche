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
}

export interface OpenDocumentOptions {
  /** Create an empty document if the file does not exist. */
  create?: boolean;
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
  /** The file was written (the call changed the document). */
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
  private readonly sessions = new Map<string, Promise<DocumentSession>>();
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
    let session = this.sessions.get(file);
    if (!session) {
      session = this.load(file, options);
      this.sessions.set(file, session);
      session.catch(() => this.sessions.delete(file));
    }
    return session;
  }

  private async load(file: string, options: OpenDocumentOptions): Promise<DocumentSession> {
    let text: string | undefined;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !options.create) throw error;
    }
    let doc: PenDocument;
    let format: PenFormat;
    if (text === undefined) {
      doc = { version: CURRENT_VERSION, children: [] };
      format = { ...DEFAULT_FORMAT };
      await writeAtomic(file, serializePen(doc, format));
    } else {
      const parsed = parsePen(text);
      // Migrated in memory; the file is rewritten only with the first change.
      doc = migratePen(parsed.doc).doc;
      format = parsed.format;
    }
    const engine = await this.engine();
    const scene = await engine.open(doc, { baseDir: dirname(file) });
    const roots = [dirname(file)];
    const extra = this.options.root ?? process.env.TUSCHE_ROOT;
    if (extra) roots.push(resolve(extra));
    return new DocumentSession(file, doc, format, scene, this.limits, roots);
  }
}

export const createExecutor = (options: ExecutorOptions = {}): Executor => new Executor(options);

/**
 * One open document: the committed tree, its scene, global variables of snippets and
 * failed snippets waiting for `edits`. Calls run one after another.
 */
export class DocumentSession {
  private globals: Globals = {};
  private readonly failed = new Map<string, string>();
  private nextEdit = 1;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly filePath: string,
    private committed: PenDocument,
    readonly format: PenFormat,
    readonly scene: Scene,
    private readonly limits: ExecLimits,
    private readonly exportDirs: readonly string[],
  ) {}

  get doc(): PenDocument {
    return this.committed;
  }

  execute(request: ExecRequest): Promise<ExecResult> {
    const run = this.queue.then(
      () => this.run(request),
      () => this.run(request),
    );
    this.queue = run.catch(() => undefined);
    return run;
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

    let saved = false;
    if (tx.changed) {
      try {
        await writeAtomic(this.filePath, serializePen(this.committed, this.format));
        saved = true;
      } catch (error) {
        warnings.push({
          code: 'save-failed',
          message: `The change is applied but the file was not written: ${(error as Error).message}`,
        });
      }
    }

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
