import { join } from 'node:path';
import { fontManager } from '@open-pencil/core/text';
import { readBytes, readJson, safeName, writeCacheFile } from './cache.ts';

export interface FontOptions {
  /** Directory of the font cache. */
  cacheDir: string;
  /** Download missing fonts (Google Fonts and others through unifont). Default `true`. */
  allowNetwork: boolean;
}

/**
 * Configures OpenPencil's font manager for headless rendering: fonts downloaded once are
 * kept on disk, so later runs (and CI with a restored cache) do not need the network.
 */
export function configureFonts({ cacheDir, allowNetwork }: FontOptions): void {
  const dir = join(cacheDir, 'fonts');
  const file = (family: string, style: string) => `${safeName(family)}--${safeName(style)}`;
  fontManager.setDownloadedFontCache({
    async read(family, style, characters = '') {
      const name = file(family, style);
      const meta = readJson<{ characters: string }>(join(dir, `${name}.json`));
      if (!meta) return null;
      const covered = new Set(meta.characters);
      if ([...characters].some((c) => !covered.has(c))) return null;
      const bytes = readBytes(join(dir, `${name}.bin`));
      return bytes ? (bytes.slice().buffer as ArrayBuffer) : null;
    },
    async write(family, style, data, characters = '') {
      const name = file(family, style);
      writeCacheFile(dir, `${name}.bin`, new Uint8Array(data));
      writeCacheFile(dir, `${name}.json`, JSON.stringify({ characters }));
    },
  });
  if (!allowNetwork) {
    fontManager.setOnlineFontProviders({ google: false, fontsource: false, bunny: false });
  }
}
