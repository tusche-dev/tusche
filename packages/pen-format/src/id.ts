import type { PenDocument, PenExtra } from './types.ts';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Every id in the document tree, including replacement nodes inside instance overrides. */
export function collectIds(doc: PenDocument): Set<string> {
  const ids = new Set<string>();
  const stack: unknown[] = Array.isArray(doc.children) ? [...doc.children] : [];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node !== 'object' || node === null) continue;
    const { id, children, descendants } = node as PenExtra;
    if (typeof id === 'string') ids.add(id);
    if (Array.isArray(children)) stack.push(...children);
    if (typeof descendants === 'object' && descendants !== null) {
      for (const value of Object.values(descendants)) {
        stack.push(value);
      }
    }
  }
  return ids;
}

/**
 * A short random id (like pen.dev's `eRmJH`) that is not in `taken`.
 * Ids never contain `/`; the new id is added to `taken`.
 */
export function generateId(taken: Set<string>, length = 5): string {
  const bytes = new Uint8Array(length);
  for (let attempt = 0; ; attempt++) {
    // Grow the id if the short space is getting crowded.
    const size = length + Math.floor(attempt / 16);
    const buffer = size === bytes.length ? bytes : new Uint8Array(size);
    crypto.getRandomValues(buffer);
    let id = '';
    for (const byte of buffer) id += ALPHABET[byte % ALPHABET.length];
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
  }
}
