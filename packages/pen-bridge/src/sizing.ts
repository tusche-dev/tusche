import type { Scope } from './scope.ts';

/** A `.pen` width or height. */
export type SizeSpec =
  | { kind: 'fixed'; value: number }
  | { kind: 'fit' | 'fill'; fallback: number | undefined };

const DYNAMIC_RE = /^(fit_content|fill_container)(?:\(\s*(-?\d+(?:\.\d+)?)\s*\))?$/;

/** Parses `120`, `"$size"`, `"fit_content"`, `"fill_container(320)"`; `undefined` when absent. */
export function parseSize(value: unknown, scope: Scope): SizeSpec | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const match = DYNAMIC_RE.exec(value.trim());
    if (match) {
      const fallback = match[2] === undefined ? undefined : Number(match[2]);
      return { kind: match[1] === 'fit_content' ? 'fit' : 'fill', fallback };
    }
  }
  const resolved = scope.value(value);
  if (typeof resolved === 'number' && Number.isFinite(resolved)) {
    return { kind: 'fixed', value: Math.max(0, resolved) };
  }
  if (typeof resolved === 'string' && resolved !== value) return parseSize(resolved, scope);
  return undefined;
}

export const isFill = (spec: SizeSpec | undefined): boolean => spec?.kind === 'fill';
