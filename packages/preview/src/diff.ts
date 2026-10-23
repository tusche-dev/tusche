import type { PenDocument } from '@tusche/pen-format';

/**
 * `to` (a document read again from disk) with the parts equal to `from` replaced by the
 * objects of `from`: top-level nodes and document-wide data (variables, themes). Identity
 * then tells what changed, as after an edit, so `rootsBetween` finds the roots to show again.
 */
export function shareUnchanged(from: PenDocument, to: PenDocument): PenDocument {
  const a = from as unknown as Record<string, unknown>;
  const shared: Record<string, unknown> = { ...to };
  for (const key of Object.keys(shared)) {
    if (key !== 'children' && key in a && same(a[key], shared[key])) shared[key] = a[key];
  }
  const before = new Map(from.children.map((node) => [node.id, node]));
  shared.children = to.children.map((node) => {
    const old = before.get(node.id);
    return old !== undefined && same(old, node) ? old : node;
  });
  return shared as unknown as PenDocument;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
