import type { initCanvasKit } from '@open-pencil/core/io/formats/raster';
import { collectNodeFontFaces, fontManager } from '@open-pencil/core/text';
import type { SceneNode } from '@open-pencil/scene-graph';

type CanvasKit = Awaited<ReturnType<typeof initCanvasKit>>;
type Typeface = NonNullable<ReturnType<CanvasKit['Typeface']['MakeTypefaceFromData']>>;

/** Characters of a text that its font has no glyphs for: they are drawn in a fallback font. */
export interface MissingGlyphs {
  /** Pen path of the text node. */
  path: string;
  family: string;
  style: string;
  /** The missing characters, each once, in order of appearance. */
  characters: string;
}

const typefaces = new WeakMap<ArrayBuffer, Typeface | null>();

function typefaceOf(ck: CanvasKit, data: ArrayBuffer): Typeface | null {
  let typeface = typefaces.get(data);
  if (typeface === undefined) {
    typeface = ck.Typeface.MakeTypefaceFromData(data);
    typefaces.set(data, typeface);
  }
  return typeface;
}

/**
 * Text nodes whose loaded font lacks glyphs for some of their characters — a Latin-only
 * web font with Cyrillic text, say. Faces that are not loaded are skipped: those are
 * missing fonts, reported separately.
 */
export function findMissingGlyphs(ck: CanvasKit, nodes: readonly SceneNode[]): MissingGlyphs[] {
  const result: MissingGlyphs[] = [];
  for (const node of nodes) {
    const characters = [...new Set(node.text)].filter((c) => c.trim() !== '');
    if (characters.length === 0) continue;
    const seen = new Set<string>();
    for (const { family, style } of collectNodeFontFaces(node)) {
      const key = `${family}\0${style}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const data = fontManager.loadedData(family, style);
      const typeface = data ? typefaceOf(ck, data) : null;
      if (!typeface) continue;
      const missing = characters.filter((c) => typeface.getGlyphIDs(c)[0] === 0);
      if (missing.length === 0) continue;
      result.push({
        path: node.id.split('#')[0] as string,
        family,
        style,
        characters: missing.join(''),
      });
    }
  }
  return result;
}
