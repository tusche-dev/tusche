import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where fonts and icons downloaded for rendering are kept: `$TUSCHE_CACHE_DIR` or `~/.cache/tusche`. */
export function defaultCacheDir(): string {
  return process.env.TUSCHE_CACHE_DIR || join(homedir(), '.cache', 'tusche');
}

/** A file name that is safe on every platform. */
export const safeName = (value: string): string =>
  value.replace(/[^\w.-]+/g, '_').slice(0, 120) || '_';

export function readBytes(path: string): Uint8Array | undefined {
  try {
    return new Uint8Array(readFileSync(path));
  } catch {
    return undefined;
  }
}

export function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/** Writes a cache file; a cache that cannot be written is not an error. */
export function writeCacheFile(dir: string, name: string, data: string | Uint8Array): void {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), data);
  } catch {
    // Read-only home or no space: rendering works without the cache.
  }
}
