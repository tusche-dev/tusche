import variant from '@jitl/quickjs-wasmfile-release-asyncify';
import {
  newQuickJSAsyncWASMModuleFromVariant,
  type QuickJSAsyncContext,
  type QuickJSAsyncWASMModule,
  type QuickJSHandle,
} from 'quickjs-emscripten-core';
import { ExecError, toWireError } from './errors.ts';
import { PRELUDE, SNIPPET_FILE, wrapSnippet } from './prelude.ts';

export interface SandboxLimits {
  /** Wall time of the whole call, host work included. Default 10 s. */
  timeMs: number;
  /** Memory of the VM. Default 256 MB. */
  memoryBytes: number;
  /** Stack of the VM. Default 1 MB. */
  stackBytes: number;
}

export const DEFAULT_SANDBOX_LIMITS: Readonly<SandboxLimits> = Object.freeze({
  timeMs: 10_000,
  memoryBytes: 256 * 1024 * 1024,
  stackBytes: 1024 * 1024,
});

/** A host function: JSON arguments in, a JSON value (or a promise of one) out. */
export type HostOp = (args: unknown[]) => unknown;

/** Global variables between calls: name → JSON text. */
export type Globals = Record<string, string>;

export interface SnippetError {
  name: string;
  message: string;
  /** Line in the snippet (1-based), when the error points into it. */
  line?: number;
  hint?: string;
}

export type RunResult =
  | { ok: true; globals: Globals; dropped: string[]; ms: number }
  | { ok: false; error: SnippetError; ms: number };

export interface RunOptions {
  code: string;
  ops: Readonly<Record<string, HostOp>>;
  globals?: Globals;
  limits?: Partial<SandboxLimits>;
}

let modulePromise: Promise<QuickJSAsyncWASMModule> | undefined;

/** The QuickJS module (one per process). */
export const quickjs = (): Promise<QuickJSAsyncWASMModule> => {
  modulePromise ??= newQuickJSAsyncWASMModuleFromVariant(variant);
  return modulePromise;
};

let queue: Promise<unknown> = Promise.resolve();

/** Asyncify allows one suspended call per module: snippets run one at a time. */
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

const isPromise = (value: unknown): value is Promise<unknown> =>
  typeof (value as { then?: unknown } | null)?.then === 'function';

const LINE_RE = new RegExp(`${SNIPPET_FILE.replace('.', '\\.')}:(\\d+)`);

/**
 * Runs a snippet in a fresh QuickJS context: fresh scope, the API from the prelude bound to
 * `ops`, global variables of the previous calls restored. Never throws for snippet errors.
 */
export function runSnippet(options: RunOptions): Promise<RunResult> {
  return exclusive(async () => {
    const limits = { ...DEFAULT_SANDBOX_LIMITS, ...options.limits };
    const started = performance.now();
    const deadline = started + limits.timeMs;
    const timedOut = () => performance.now() > deadline;
    const ms = () => performance.now() - started;
    const module = await quickjs();
    const ctx = module.newContext();
    try {
      ctx.runtime.setMemoryLimit(limits.memoryBytes);
      ctx.runtime.setMaxStackSize(limits.stackBytes);
      ctx.runtime.setInterruptHandler(timedOut);
      installHost(ctx, options.ops, timedOut, limits.timeMs);

      const prelude = ctx.evalCode(PRELUDE, 'tusche:prelude');
      ctx.unwrapResult(prelude).dispose();
      const restore = ctx.evalCode(
        `__tuscheRestore(${JSON.stringify(JSON.stringify(options.globals ?? {}))})`,
        'tusche:globals',
      );
      ctx.unwrapResult(restore).dispose();

      const result = await ctx.evalCodeAsync(wrapSnippet(options.code), SNIPPET_FILE);
      if (result.error) {
        const error = describeError(ctx, result.error, timedOut(), limits);
        result.error.dispose();
        return { ok: false, error, ms: ms() };
      }
      result.value.dispose();

      const collected = ctx.evalCode('__tuscheCollect()', 'tusche:globals');
      const json = ctx.unwrapResult(collected).consume((h) => ctx.getString(h));
      const { saved, dropped } = JSON.parse(json) as { saved: Globals; dropped: string[] };
      return { ok: true, globals: saved, dropped, ms: ms() };
    } catch (error) {
      // The VM itself failed (out of memory during setup, a broken context).
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: { name: 'InternalError', message }, ms: ms() };
    } finally {
      try {
        ctx.dispose();
      } catch {
        // A context that ran out of memory may fail to free; the module stays usable.
      }
    }
  });
}

function installHost(
  ctx: QuickJSAsyncContext,
  ops: Readonly<Record<string, HostOp>>,
  timedOut: () => boolean,
  timeMs: number,
): void {
  const respond = (value: unknown) => ctx.newString(JSON.stringify(value));
  const fail = (error: unknown) => respond({ error: toWireError(error) });
  const fn = ctx.newAsyncifiedFunction('__host', ((
    opHandle: QuickJSHandle,
    argsHandle: QuickJSHandle,
  ) => {
    const op = ctx.getString(opHandle);
    try {
      if (timedOut()) throw timeLimit(timeMs);
      const run = Object.hasOwn(ops, op) ? ops[op] : undefined;
      if (!run) throw new Error(`unknown host function ${op}`);
      const result = run(JSON.parse(ctx.getString(argsHandle)) as unknown[]);
      // Only a returned promise suspends the VM; everything else answers right away.
      if (isPromise(result)) return result.then((value) => respond({ value }), fail);
      return respond({ value: result });
    } catch (error) {
      return fail(error);
    }
    // The typings ask for a promise; the runtime accepts both.
  }) as never);
  ctx.setProp(ctx.global, '__host', fn);
  fn.dispose();
}

const timeLimit = (timeMs: number) =>
  new ExecError(`The call took longer than ${timeMs / 1000} s and was stopped`, {
    name: 'TimeoutError',
    hint: 'split the work into several calls, or make loops and visitors do less',
  });

function describeError(
  ctx: QuickJSAsyncContext,
  handle: QuickJSHandle,
  timedOut: boolean,
  limits: SandboxLimits,
): SnippetError {
  const timeMs = limits.timeMs;
  const text = (name: string) => {
    if (ctx.typeof(handle) !== 'object') return undefined;
    const value = ctx.getProp(handle, name);
    const type = ctx.typeof(value);
    const result = type === 'undefined' ? undefined : ctx.getString(value);
    value.dispose();
    return result;
  };
  let name = text('name') ?? 'Error';
  let message = text('message') ?? ctx.dump(handle);
  const stack = text('stack') ?? '';
  const hint = text('hint');
  if (timedOut || (name === 'InternalError' && message === 'interrupted')) {
    const limit = timeLimit(timeMs);
    name = limit.name;
    message = limit.message;
  } else if (name === 'InternalError' && /out of memory/i.test(message)) {
    name = 'MemoryError';
    message = `The snippet ran out of memory (limit ${Math.round(limits.memoryBytes / 2 ** 20)} MB)`;
  } else if (name === 'InternalError' && /stack overflow/i.test(message)) {
    name = 'RangeError';
    message = 'Maximum call stack size exceeded';
  }
  const error: SnippetError = { name, message: String(message) };
  const line = LINE_RE.exec(stack)?.[1];
  if (line !== undefined) error.line = Number(line);
  const fixed = timedOut ? timeLimit(timeMs).hint : hint;
  if (fixed) error.hint = fixed;
  return error;
}
