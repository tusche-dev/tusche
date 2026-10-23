import { createHash } from 'node:crypto';
import { fontManager } from '@open-pencil/core/text';
import type { Scene } from './engine.ts';
import type { FontFile, RootSnapshot } from './snapshot-codec.ts';

/**
 * Lays out a top-level node and returns its scene for the preview page: every scene node of
 * the subtree (the root first) and the images they refer to. `undefined` for an id that is
 * not a top-level node of the document.
 */
export async function snapshotRoot(
  scene: Scene,
  rootId: string,
): Promise<RootSnapshot | undefined> {
  if (!scene.projection.topLevelIds.includes(rootId)) return undefined;
  await scene.layout([rootId]);
  const graph = scene.projection.graph;
  const nodes = [];
  const stack = [rootId];
  while (stack.length > 0) {
    const node = graph.getNode(stack.pop() as string);
    if (!node) continue;
    nodes.push(node);
    for (let i = node.childIds.length - 1; i >= 0; i--) stack.push(node.childIds[i] as string);
  }
  if (nodes.length === 0) return undefined;
  const images: [string, Uint8Array][] = [];
  if (graph.images.size > 0) {
    const hashes = new Set<string>();
    collectStrings(nodes, hashes);
    for (const hash of hashes) {
      const bytes = graph.images.get(hash);
      if (bytes) images.push([hash, bytes]);
    }
  }
  return { id: rootId, nodes, images };
}

/** A font file with its bytes. */
export interface FontData extends FontFile {
  data: Uint8Array;
}

/**
 * Every font file the engine has loaded, in the order the page should load them: for each
 * face, its extra files (other character ranges, older subsets) before the primary one, as
 * OpenPencil's font manager keeps the last file it was given as the primary.
 */
export function loadedFontFiles(): FontData[] {
  // The font manager does not list its faces; read its tables.
  const manager = fontManager as unknown as {
    loadedFamilies: Map<string, ArrayBuffer>;
    supplementalFamilyData: Map<string, ArrayBuffer[]>;
  };
  const files: FontData[] = [];
  for (const [key, primary] of manager.loadedFamilies) {
    const separator = key.indexOf('|');
    const family = key.slice(0, separator);
    const style = key.slice(separator + 1);
    const extra = (manager.supplementalFamilyData.get(key) ?? []).filter((b) => b !== primary);
    for (const buffer of [...extra, primary]) {
      files.push({ id: fontId(buffer), family, style, data: new Uint8Array(buffer) });
    }
  }
  return files;
}

const fontIds = new WeakMap<ArrayBuffer, string>();

function fontId(buffer: ArrayBuffer): string {
  let id = fontIds.get(buffer);
  if (id === undefined) {
    id = createHash('sha1').update(new Uint8Array(buffer)).digest('hex').slice(0, 16);
    fontIds.set(buffer, id);
  }
  return id;
}

/** Image hashes appear as plain strings in fills; collect every string to look them up. */
function collectStrings(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    into.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
  } else if (value instanceof Map) {
    for (const item of value.values()) collectStrings(item, into);
  } else if (value !== null && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    for (const item of Object.values(value)) collectStrings(item, into);
  }
}
