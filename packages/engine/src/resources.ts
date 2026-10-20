import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { IconifyJSON } from '@iconify/types';
import {
  bundledIcons,
  chainIconProviders,
  type IconProvider,
  iconifyName,
  iconSetProvider,
} from '@tusche/pen-bridge';
import type { PenDocument } from '@tusche/pen-format';
import { readJson, safeName, writeCacheFile } from './cache.ts';

type Obj = Record<string, unknown>;
const isObject = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every object in the document, including overrides and replacements in `descendants`. */
function* objects(value: unknown): Generator<Obj> {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const item = stack.pop();
    if (Array.isArray(item)) stack.push(...item);
    else if (isObject(item)) {
      yield item;
      for (const child of Object.values(item)) if (typeof child === 'object') stack.push(child);
    }
  }
}

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

/** Characters of all text in the document (contents and string variables), plus printable ASCII. */
export function documentCharacters(doc: PenDocument): string {
  const chars = new Set(ASCII);
  const add = (value: unknown) => {
    if (typeof value === 'string') for (const c of value) chars.add(c);
  };
  for (const obj of objects(doc.children)) add(obj.content);
  for (const obj of objects(doc.variables)) {
    if (obj.type === 'string' || 'theme' in obj) add(obj.value);
  }
  for (const c of [...chars]) {
    chars.add(c.toLowerCase());
    chars.add(c.toUpperCase());
  }
  chars.add('\n');
  return [...chars].sort().join('');
}

const isRemote = (url: string) => /^https?:\/\//i.test(url);

/** Image URLs used by fills and strokes. */
export function imageUrls(doc: PenDocument): Set<string> {
  const urls = new Set<string>();
  for (const obj of objects(doc.children)) {
    if (obj.type === 'image' && typeof obj.url === 'string') urls.add(obj.url);
  }
  return urls;
}

export interface AssetOptions {
  /** Directory of the `.pen` file; relative URLs resolve against it. */
  baseDir?: string | undefined;
  /** Fetch `http(s)` images. Default `false`. */
  allowRemoteAssets?: boolean | undefined;
}

export type AssetLoader = (url: string) => Uint8Array | undefined;

/**
 * A synchronous asset loader for the projection: local files are read on demand,
 * remote images are fetched up front (only when allowed). With `base`, only remote
 * images that `base` does not have are fetched, and `base` answers the rest.
 */
export async function createAssetLoader(
  doc: PenDocument,
  { baseDir, allowRemoteAssets = false }: AssetOptions,
  base?: AssetLoader,
): Promise<AssetLoader> {
  const remote = new Map<string, Uint8Array>();
  if (allowRemoteAssets) {
    await Promise.all(
      [...imageUrls(doc)]
        .filter((url) => isRemote(url) && !base?.(url))
        .map(async (url) => {
          try {
            const response = await fetch(url);
            if (response.ok) remote.set(url, new Uint8Array(await response.arrayBuffer()));
          } catch {
            // Reported by the projection as a missing asset.
          }
        }),
    );
  }
  return (url) => {
    if (isRemote(url)) return remote.get(url) ?? base?.(url);
    if (baseDir === undefined) return undefined;
    try {
      return new Uint8Array(readFileSync(resolve(baseDir, decodeURI(url))));
    } catch {
      try {
        return new Uint8Array(readFileSync(resolve(baseDir, url)));
      } catch {
        return undefined;
      }
    }
  };
}

const ICONIFY_API = 'https://api.iconify.design';

/**
 * Icons for a document: bundled sets first; icons of other libraries (Material Symbols,
 * Feather, …) come from the Iconify API and are cached on disk.
 */
export async function createIconProvider(
  doc: PenDocument,
  options: { cacheDir: string; allowNetwork: boolean },
  /** Icons already available; only the ones it does not have are loaded. Default: bundled sets. */
  base: IconProvider = bundledIcons(),
): Promise<IconProvider> {
  const { cacheDir, allowNetwork } = options;
  const wanted = new Map<string, Set<string>>();
  for (const obj of objects(doc.children)) {
    if (obj.type !== 'icon' || typeof obj.library !== 'string' || typeof obj.icon !== 'string') {
      continue;
    }
    if (obj.library.startsWith('$') || obj.icon.startsWith('$')) continue;
    const weight = typeof obj.weight === 'number' ? obj.weight : undefined;
    if (base.get(obj.library, obj.icon, weight)) continue;
    const target = iconifyName(obj.library, obj.icon, weight);
    if (!target) continue;
    const names = wanted.get(target.prefix) ?? new Set<string>();
    for (const name of target.names) names.add(name);
    wanted.set(target.prefix, names);
  }
  if (wanted.size === 0) return base;

  const dir = join(cacheDir, 'icons');
  const sets = new Map<string, IconifyJSON>();
  for (const [prefix, names] of wanted) {
    const file = `${safeName(prefix)}.json`;
    const set: IconifyJSON = readJson<IconifyJSON>(join(dir, file)) ?? { prefix, icons: {} };
    const known = new Set([
      ...Object.keys(set.icons),
      ...Object.keys(set.aliases ?? {}),
      ...((set.not_found as string[] | undefined) ?? []),
    ]);
    const missing = [...names].filter((name) => !known.has(name));
    if (missing.length > 0 && allowNetwork) {
      try {
        const url = `${ICONIFY_API}/${prefix}.json?icons=${missing.map(encodeURIComponent).join(',')}`;
        const response = await fetch(url);
        if (response.ok) {
          const fetched = (await response.json()) as IconifyJSON;
          Object.assign(set.icons, fetched.icons);
          set.aliases = { ...set.aliases, ...fetched.aliases };
          set.not_found = [...new Set([...(set.not_found ?? []), ...(fetched.not_found ?? [])])];
          for (const key of ['width', 'height'] as const) {
            if (fetched[key] !== undefined) set[key] = fetched[key];
          }
          writeCacheFile(dir, file, JSON.stringify(set));
        }
      } catch {
        // Offline: the projection reports these icons as unknown.
      }
    }
    sets.set(prefix, set);
  }
  return chainIconProviders(base, iconSetProvider(sets));
}
