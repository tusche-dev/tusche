import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fontManager } from '@open-pencil/core/text';
import { readBytes, readJson, safeName, writeCacheFile } from './cache.ts';

export interface FontOptions {
  /** Directory of the font cache. */
  cacheDir: string;
  /** Download missing fonts (Google Fonts and others through unifont). Default `true`. */
  allowNetwork: boolean;
}

/** Subsets of one face kept on disk: web fonts are downloaded for the characters asked for. */
interface FaceIndex {
  subsets: { file: string; characters: string }[];
}

/** At most this many subsets per face; the oldest go first. */
const MAX_SUBSETS = 8;

/**
 * Configures OpenPencil's font manager for headless rendering: fonts downloaded once are
 * kept on disk, so later runs (and CI with a restored cache) do not need the network.
 * Every downloaded subset is kept, and any subset that covers the requested characters is
 * used, so documents with different text do not evict each other's fonts.
 */
export function configureFonts({ cacheDir, allowNetwork }: FontOptions): void {
  const dir = join(cacheDir, 'fonts');
  const face = (family: string, style: string) => `${safeName(family)}--${safeName(style)}`;
  const indexOf = (name: string): FaceIndex =>
    readJson<FaceIndex>(join(dir, `${name}.json`)) ?? { subsets: [] };
  fontManager.setDownloadedFontCache({
    async read(family, style, characters = '') {
      const name = face(family, style);
      const wanted = [...characters];
      for (const subset of indexOf(name).subsets) {
        const covered = new Set(subset.characters);
        if (!wanted.every((c) => covered.has(c))) continue;
        const bytes = readBytes(join(dir, subset.file));
        if (bytes) return bytes.slice().buffer as ArrayBuffer;
      }
      return null;
    },
    async write(family, style, data, characters = '') {
      const name = face(family, style);
      const hash = createHash('sha1').update(characters).digest('hex').slice(0, 12);
      const file = `${name}--${hash}.bin`;
      writeCacheFile(dir, file, new Uint8Array(data));
      const index = indexOf(name);
      const subsets = [{ file, characters }, ...index.subsets.filter((s) => s.file !== file)];
      writeCacheFile(
        dir,
        `${name}.json`,
        JSON.stringify({ subsets: subsets.slice(0, MAX_SUBSETS) }),
      );
    },
  });
  if (!allowNetwork) {
    fontManager.setOnlineFontProviders({ google: false, fontsource: false, bunny: false });
  }
}
