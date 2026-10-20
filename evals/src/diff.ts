/**
 * How much an edit changed a document. The writer keeps the file's style (ADR-006), so a
 * line diff of two saves measures the change itself, not reformatting.
 */

/**
 * Lines added plus lines removed between two texts: the common head and tail are skipped,
 * the middle is compared as a multiset of lines (moves inside it count as changes).
 */
export function changedLines(before: string, after: string): number {
  const a = before.split('\n');
  const b = after.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const counts = new Map<string, number>();
  for (const line of a.slice(head, a.length - tail)) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of b.slice(head, b.length - tail)) {
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else added++;
  }
  let removed = 0;
  for (const left of counts.values()) removed += left;
  return added + removed;
}

interface PenLike {
  children?: { id?: string }[];
  variables?: unknown;
  themes?: unknown;
}

/**
 * Top-level ids changed, added or removed outside `scope`, plus `"variables"` when variables
 * or themes changed and the scope does not allow it.
 */
export function outOfScope(before: PenLike, after: PenLike, scope: readonly string[]): string[] {
  const allowed = new Set(scope);
  const result: string[] = [];
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  if (
    !allowed.has('variables') &&
    (!same(before.variables, after.variables) || !same(before.themes, after.themes))
  ) {
    result.push('variables');
  }
  const roots = (doc: PenLike) => new Map((doc.children ?? []).map((n) => [n.id ?? '', n]));
  const a = roots(before);
  const b = roots(after);
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    if (!allowed.has(id) && !same(a.get(id), b.get(id))) result.push(id);
  }
  return result;
}
