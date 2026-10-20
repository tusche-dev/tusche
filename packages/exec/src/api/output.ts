import { extname, isAbsolute, relative, resolve } from 'node:path';
import type { ExportFormat } from '@tusche/engine';
import { splitIdPath } from '@tusche/pen-format';
import { argumentError, ExecError } from '../errors.ts';
import { chainTo, isObject } from '../tree.ts';
import type { Reader } from './reads.ts';

export interface OutputLimits {
  /** Screenshots per call. Default 6. */
  screenshots: number;
  /** Characters of `Print` output per call. Default 20 000. */
  printChars: number;
}

export const DEFAULT_OUTPUT_LIMITS: Readonly<OutputLimits> = Object.freeze({
  screenshots: 6,
  printChars: 20_000,
});

export interface ScreenshotJob {
  path: string;
  scale: number;
}

export interface ExportJob {
  paths: string[];
  format: ExportFormat;
  /** Absolute path of the file to write. */
  file: string;
  scale?: number;
}

const FORMATS: Readonly<Record<string, string>> = {
  png: '.png',
  jpeg: '.jpg',
  webp: '.webp',
  svg: '.svg',
  pdf: '.pdf',
  'html-tailwind': '.html',
};

function readScale(options: unknown, fn: string): number | undefined {
  if (options === undefined || options === null) return undefined;
  if (!isObject(options)) throw argumentError(`${fn}(): options must be an object`);
  const { scale } = options;
  if (scale === undefined) return undefined;
  if (typeof scale !== 'number' || !(scale > 0) || scale > 4) {
    throw argumentError(`${fn}(): scale must be a number in (0, 4], got ${JSON.stringify(scale)}`);
  }
  return scale;
}

function readIds(ids: unknown, fn: string): string[] {
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) {
    throw argumentError(
      `${fn}(): the first argument must be a non-empty list of node ids`,
      `for example ${fn}([heroId])`,
    );
  }
  return ids as string[];
}

/**
 * What the snippet asked to show or write. Nothing happens during the call: screenshots
 * and exports run after the commit, so a failed call has no side effects (ADR-008).
 */
export class Outputs {
  readonly prints: string[] = [];
  printTruncated = false;
  readonly screenshots: ScreenshotJob[] = [];
  readonly exports: ExportJob[] = [];
  private printed = 0;

  constructor(
    private readonly reader: Reader,
    /** Directory of the document: relative export paths start there. */
    private readonly baseDir: string,
    /** Directories exports may write to (the document's directory and `TUSCHE_ROOT`). */
    private readonly allowedDirs: readonly string[],
    private readonly limits: OutputLimits = DEFAULT_OUTPUT_LIMITS,
  ) {}

  print(values: unknown): void {
    const line = Array.isArray(values) ? values.map(String).join(' ') : String(values);
    if (this.printTruncated) return;
    const room = this.limits.printChars - this.printed;
    if (line.length > room) {
      this.prints.push(`${line.slice(0, Math.max(0, room))}…`);
      this.printTruncated = true;
      return;
    }
    this.prints.push(line);
    this.printed += line.length + 1;
  }

  screenshot(ids: unknown, options: unknown): void {
    const paths = readIds(ids, 'TakeScreenshot');
    const scale = readScale(options, 'TakeScreenshot') ?? 1;
    if (this.screenshots.length + paths.length > this.limits.screenshots) {
      throw new ExecError(
        `TakeScreenshot(): at most ${this.limits.screenshots} screenshots per call`,
        { name: 'RangeError', hint: 'screenshot the parent frame instead of each child' },
      );
    }
    for (const path of paths) {
      this.reader.require(path, 'TakeScreenshot');
      this.screenshots.push({ path, scale });
    }
  }

  export(ids: unknown, format: unknown, outPath: unknown, options: unknown): string {
    const paths = readIds(ids, 'Export');
    if (typeof format !== 'string' || !(format in FORMATS)) {
      throw argumentError(`Export(): format must be one of ${Object.keys(FORMATS).join(', ')}`);
    }
    if (format === 'pdf') {
      throw new ExecError('Export(): pdf is not available yet', {
        hint: 'export svg or png instead',
      });
    }
    if (typeof outPath !== 'string' || outPath === '') {
      throw argumentError('Export(): outPath must be a file path, e.g. "exports/hero.png"');
    }
    const scale = readScale(options, 'Export');
    const roots = new Set(paths.map((path) => this.rootOf(path)));
    if (roots.size > 1) {
      throw argumentError(
        'Export(): all nodes must belong to the same top-level frame',
        'export each top-level frame separately',
      );
    }
    let file = resolve(this.baseDir, outPath);
    if (extname(file) === '') file += FORMATS[format];
    const inside = this.allowedDirs.some((dir) => {
      const rest = relative(dir, file);
      return rest !== '' && !rest.startsWith('..') && !isAbsolute(rest);
    });
    if (!inside) {
      throw new ExecError(`Export(): "${outPath}" is outside the document folder`, {
        hint: 'write next to the .pen file, or set TUSCHE_ROOT to allow a wider folder',
      });
    }
    const job: ExportJob = { paths, format: format as ExportFormat, file };
    if (scale !== undefined) job.scale = scale;
    this.exports.push(job);
    return file;
  }

  private rootOf(path: string): string {
    this.reader.require(path, 'Export');
    const tx = this.reader.tx;
    const top = tx.index.get(splitIdPath(path)[0] as string);
    const chain = top ? chainTo(tx.doc, top) : undefined;
    return (chain?.[1]?.id as string | undefined) ?? path;
  }
}

export function generate(): never {
  throw new ExecError('Generate() is not available in Tusche', {
    hint: 'make images with your own tools, save them next to the .pen file and use them as image fills',
  });
}
