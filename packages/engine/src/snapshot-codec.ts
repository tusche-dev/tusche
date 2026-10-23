import type { SceneNode } from '@open-pencil/scene-graph';

/**
 * A laid-out top-level node as the preview sends it: its scene nodes (the root first) and
 * the images they show. Sizes and positions are final, so the page only draws them.
 */
export interface RootSnapshot {
  id: string;
  nodes: SceneNode[];
  /** Image hash → bytes, for the images the nodes refer to. */
  images: [string, Uint8Array][];
}

/** A font file loaded by the engine. `id` is a hash of the bytes. */
export interface FontFile {
  id: string;
  family: string;
  style: string;
}

/**
 * What the preview server sends over its socket:
 * - `update`: the document's top-level nodes in paint order, the roots that changed (all of
 *   them for a new page), and every font file the text may need, in loading order;
 * - `error`: the file cannot be shown (the last good state stays on screen).
 */
export type PreviewMessage =
  | {
      type: 'update';
      file: string;
      order: string[];
      roots: RootSnapshot[];
      fonts: FontFile[];
    }
  | { type: 'error'; file: string; message: string };

// Scene nodes are plain data except for typed arrays and maps (instance overrides).
const replacer = (_key: string, value: unknown): unknown => {
  if (value instanceof Uint8Array) return { $u8: toBase64(value) };
  if (value instanceof Float32Array) return { $f32: [...value] };
  if (value instanceof Float64Array) return { $f64: [...value] };
  if (value instanceof Map) return { $map: [...value] };
  if (value instanceof Set) return { $set: [...value] };
  return value;
};

const reviver = (_key: string, value: unknown): unknown => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const tagged = value as Record<string, unknown>;
  if (typeof tagged.$u8 === 'string') return fromBase64(tagged.$u8);
  if (Array.isArray(tagged.$f32)) return new Float32Array(tagged.$f32 as number[]);
  if (Array.isArray(tagged.$f64)) return new Float64Array(tagged.$f64 as number[]);
  if (Array.isArray(tagged.$map)) return new Map(tagged.$map as [unknown, unknown][]);
  if (Array.isArray(tagged.$set)) return new Set(tagged.$set as unknown[]);
  return value;
};

export const encodeMessage = (message: PreviewMessage): string => JSON.stringify(message, replacer);

export const decodeMessage = (text: string): PreviewMessage =>
  JSON.parse(text, reviver) as PreviewMessage;

const CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
