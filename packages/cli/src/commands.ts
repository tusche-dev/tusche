import { readFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import type { ExportFormat } from '@tusche/engine';
import {
  createExecutor,
  type DocumentSession,
  type Executor,
  formatLint,
  formatResult,
  lintCounts,
  lintDocument,
  writeAtomic,
} from '@tusche/exec';
import {
  formatDiagnostic,
  migratePen,
  PenParseError,
  parsePen,
  serializePen,
  validatePen,
} from '@tusche/pen-format';

/** A wrong invocation: printed with the usage hint, exit code 2. */
export class UsageError extends Error {}

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  cwd: string;
  /** Text of the snippet when `exec` reads it from `-`. */
  stdin: () => Promise<string>;
}

export type Flags = Record<string, string | boolean | string[] | undefined>;

const EXPORT_FORMATS: readonly ExportFormat[] = ['png', 'jpeg', 'webp', 'svg', 'html-tailwind'];
const EXTENSIONS: Record<string, string> = { jpeg: 'jpg', 'html-tailwind': 'html' };

const executor = (): Executor =>
  createExecutor({ engineOptions: { allowNetwork: process.env.TUSCHE_FONTS_OFFLINE !== '1' } });

const shown = (io: Io, file: string) => {
  const rel = relative(io.cwd, file);
  return rel.startsWith('..') || rel === '' ? file : rel.split('\\').join('/');
};

const fileName = (id: string) => id.replace(/[^\w-]/g, '_');

const number = (flags: Flags, name: string): number | undefined => {
  const value = flags[name];
  if (value === undefined) return undefined;
  const n = Number(value);
  if (typeof value !== 'string' || !Number.isFinite(n) || n <= 0) {
    throw new UsageError(`--${name} must be a positive number`);
  }
  return n;
};

const list = (flags: Flags, name: string): string[] => {
  const value = flags[name];
  return Array.isArray(value) ? value.flatMap((v) => v.split(',')).filter(Boolean) : [];
};

async function openFile(io: Io, file: string, create = false): Promise<DocumentSession> {
  try {
    return await executor().open(resolve(io.cwd, file), { create });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new UsageError(`no file at ${file}`);
    }
    throw error;
  }
}

/** `tusche exec <file.pen> <script.js | ->`: one execute call, saved right away. */
export async function execCommand(io: Io, args: string[], flags: Flags): Promise<number> {
  const [file, script] = args;
  if (file === undefined || script === undefined) {
    throw new UsageError('exec needs a .pen file and a script (or - for stdin)');
  }
  const input = script === '-' ? await io.stdin() : await readFile(resolve(io.cwd, script), 'utf8');
  const session = await openFile(io, file, flags.create === true);
  const result = await session.execute({ input });
  const { text, images } = formatResult(result);
  io.out(text);
  if (images.length > 0) {
    if (typeof flags.out === 'string') {
      const dir = resolve(io.cwd, flags.out);
      for (const shot of images) {
        const target = join(dir, `${fileName(shot.path)}.png`);
        await writeAtomic(target, shot.png);
        io.out(`screenshot: ${shown(io, target)}`);
      }
    } else {
      io.out(`${images.length} screenshot(s) not written; pass --out <dir>`);
    }
  }
  return result.ok ? 0 : 1;
}

/** `tusche render <file.pen> [--node id]… [--scale n] [--max-side px] [--out dir]`. */
export async function renderCommand(io: Io, args: string[], flags: Flags): Promise<number> {
  const [file] = args;
  if (file === undefined) throw new UsageError('render needs a .pen file');
  const session = await openFile(io, file);
  const nodes = list(flags, 'node');
  const ids = nodes.length > 0 ? nodes : session.scene.projection.topLevelIds;
  const scale = number(flags, 'scale') ?? 1;
  const maxSide = number(flags, 'max-side');
  const out = resolve(
    io.cwd,
    typeof flags.out === 'string' ? flags.out : `${basename(file, '.pen')}.renders`,
  );
  let missing = 0;
  for (const id of ids) {
    const png =
      session.scene.projection.rootOf(id) === undefined
        ? undefined
        : await session.scene.export(
            [id],
            'png',
            maxSide === undefined ? { scale } : { scale, maxSide },
          );
    if (!png) {
      io.err(`${id}: nothing to render (unknown node or empty)`);
      missing++;
      continue;
    }
    const target = join(out, `${fileName(id)}.png`);
    await writeAtomic(target, png);
    io.out(shown(io, target));
  }
  return missing > 0 && nodes.length > 0 ? 1 : 0;
}

/** `tusche export <file.pen> --format f [--node id]… --out path`. */
export async function exportCommand(io: Io, args: string[], flags: Flags): Promise<number> {
  const [file] = args;
  if (file === undefined) throw new UsageError('export needs a .pen file');
  const format = flags.format;
  if (typeof format !== 'string' || !EXPORT_FORMATS.includes(format as ExportFormat)) {
    throw new UsageError(`--format must be one of ${EXPORT_FORMATS.join(', ')}`);
  }
  if (typeof flags.out !== 'string') throw new UsageError('export needs --out');
  const ext = EXTENSIONS[format] ?? format;
  const scale = number(flags, 'scale');
  const options = scale === undefined ? {} : { scale };
  const session = await openFile(io, file);
  const nodes = list(flags, 'node');
  const jobs =
    nodes.length > 0
      ? [
          {
            paths: nodes,
            target: resolve(io.cwd, extname(flags.out) ? flags.out : `${flags.out}.${ext}`),
          },
        ]
      : session.scene.projection.topLevelIds.map((id) => ({
          paths: [id],
          target: join(resolve(io.cwd, flags.out as string), `${fileName(id)}.${ext}`),
        }));
  let failed = 0;
  for (const job of jobs) {
    try {
      const data = await session.scene.export(job.paths, format as ExportFormat, options);
      if (!data) throw new Error('nothing to export (unknown node or empty)');
      await writeAtomic(job.target, data);
      io.out(shown(io, job.target));
    } catch (error) {
      io.err(`${job.paths.join(', ')}: ${(error as Error).message}`);
      failed++;
    }
  }
  return failed > 0 ? 1 : 0;
}

/** `tusche lint <file.pen> [--node id] [--info] [--format text|json]`; exit 1 on errors. */
export async function lintCommand(io: Io, args: string[], flags: Flags): Promise<number> {
  const [file] = args;
  if (file === undefined) throw new UsageError('lint needs a .pen file');
  const format = flags.format ?? 'text';
  if (format !== 'text' && format !== 'json') throw new UsageError('--format must be text or json');
  const node = list(flags, 'node')[0];
  const session = await openFile(io, file);
  const issues = await lintDocument(session, {
    ...(node === undefined ? {} : { path: node }),
    info: flags.info === true,
  });
  io.out(format === 'json' ? JSON.stringify(issues, null, 2) : formatLint(issues));
  return lintCounts(issues).error > 0 ? 1 : 0;
}

async function readPen(io: Io, file: string) {
  const path = resolve(io.cwd, file);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new UsageError(`no file at ${file}`);
    throw error;
  }
  return { path, parsed: parsePen(text) };
}

/** `tusche validate <file.pen> [--info]`: schema check; exit 1 on errors. */
export async function validateCommand(io: Io, args: string[], flags: Flags): Promise<number> {
  const [file] = args;
  if (file === undefined) throw new UsageError('validate needs a .pen file');
  let parsed: Awaited<ReturnType<typeof readPen>>['parsed'];
  try {
    ({ parsed } = await readPen(io, file));
  } catch (error) {
    if (error instanceof PenParseError) {
      io.out(`error parse: ${error.message}`);
      return 1;
    }
    throw error;
  }
  const diagnostics = validatePen(parsed.doc).filter(
    (d) => flags.info === true || d.level !== 'info',
  );
  for (const d of diagnostics) io.out(formatDiagnostic(d));
  const errors = diagnostics.filter((d) => d.level === 'error').length;
  const warnings = diagnostics.filter((d) => d.level === 'warning').length;
  io.out(`${shown(io, resolve(io.cwd, file))}: ${errors} error(s), ${warnings} warning(s)`);
  return errors > 0 ? 1 : 0;
}

/** `tusche migrate <file.pen> [--dry-run]`: writes the file in the current format version. */
export async function migrateCommand(io: Io, args: string[], flags: Flags): Promise<number> {
  const [file] = args;
  if (file === undefined) throw new UsageError('migrate needs a .pen file');
  const { path, parsed } = await readPen(io, file);
  const result = migratePen(parsed.doc);
  for (const d of result.diagnostics) io.out(formatDiagnostic(d));
  if (result.from === result.to && result.applied.length === 0) {
    io.out(`${shown(io, path)}: already ${result.to}, nothing to do`);
    return 0;
  }
  const steps = result.applied.length > 0 ? ` (${result.applied.join(', ')})` : '';
  io.out(`${shown(io, path)}: ${result.from} → ${result.to}${steps}`);
  if (flags['dry-run'] === true) return 0;
  await writeAtomic(path, serializePen(result.doc, parsed.format));
  return 0;
}

export const COMMANDS = {
  exec: execCommand,
  render: renderCommand,
  export: exportCommand,
  lint: lintCommand,
  validate: validateCommand,
  migrate: migrateCommand,
} as const;
