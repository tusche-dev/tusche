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

const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

/** Names of the variables a subtree refers to (`"$name"` values). */
function referenced(node: unknown, into: Set<string>): Set<string> {
  if (typeof node === 'string') {
    if (node.startsWith('$')) into.add(node.slice(1));
  } else if (Array.isArray(node)) {
    for (const item of node) referenced(item, into);
  } else if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node)) referenced(value, into);
  }
  return into;
}

/**
 * Whether the variable changes stay inside the scope: themes are untouched and every changed
 * variable is used by the scoped roots only — changing it changes nothing else.
 */
function variablesInScope(before: PenLike, after: PenLike, allowed: ReadonlySet<string>): boolean {
  if (!same(before.themes, after.themes)) return false;
  const a = (before.variables ?? {}) as Record<string, unknown>;
  const b = (after.variables ?? {}) as Record<string, unknown>;
  const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (name) => !same(a[name], b[name]),
  );
  if (changed.length === 0) return true;
  const inside = new Set<string>();
  const outside = new Set<string>();
  for (const root of before.children ?? []) {
    referenced(root, allowed.has(root.id ?? '') ? inside : outside);
  }
  return changed.every((name) => inside.has(name) && !outside.has(name));
}

/**
 * Top-level ids changed, added or removed outside `scope`, plus `"variables"` when variables
 * or themes changed and the scope does not allow it. A variable used only by the scoped roots
 * may change: that is an edit of those roots.
 */
export function outOfScope(before: PenLike, after: PenLike, scope: readonly string[]): string[] {
  const allowed = new Set(scope);
  const result: string[] = [];
  if (!allowed.has('variables') && !variablesInScope(before, after, allowed)) {
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
