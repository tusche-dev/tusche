import type { PenDocument, PenExtra, ThemeSelection, VariableDefinition } from './types.ts';

/** Active theme: a value for every axis. */
export type ThemeContext = Readonly<Record<string, string>>;

const isObject = (value: unknown): value is PenExtra =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const MAX_CHAIN = 32;

/** The default theme: the first value of every axis in `themes`. */
export function defaultTheme(doc: PenDocument): ThemeContext {
  const context: Record<string, string> = {};
  if (!isObject(doc.themes)) return context;
  for (const [axis, values] of Object.entries(doc.themes)) {
    if (Array.isArray(values) && typeof values[0] === 'string') context[axis] = values[0];
  }
  return context;
}

/** The theme below a node: `theme` on the node overrides the inherited axes. */
export function themeAt(parent: ThemeContext, theme: unknown): ThemeContext {
  if (!isObject(theme)) return parent;
  const own = Object.entries(theme).filter((entry): entry is [string, string] => {
    return typeof entry[1] === 'string';
  });
  if (own.length === 0) return parent;
  return { ...parent, ...Object.fromEntries(own) };
}

/** `"$name"` → `"name"`; anything else → `undefined`. */
export const variableName = (value: unknown): string | undefined =>
  typeof value === 'string' && value.startsWith('$') && value.length > 1
    ? value.slice(1)
    : undefined;

const matches = (selection: ThemeSelection | undefined, context: ThemeContext): boolean => {
  if (!isObject(selection)) return true;
  return Object.entries(selection).every(([axis, value]) => context[axis] === value);
};

function pick(definition: VariableDefinition, context: ThemeContext, fallback: ThemeContext) {
  const value = definition.value;
  if (!Array.isArray(value)) return { found: true, value };
  const entries = value.filter(isObject);
  for (const ctx of [context, fallback]) {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] as PenExtra;
      if (matches(entry.theme as ThemeSelection | undefined, ctx)) {
        return { found: true, value: entry.value };
      }
    }
  }
  const first = entries[0];
  return first ? { found: true, value: first.value } : { found: false, value: undefined };
}

export type VariableResolver = (value: unknown, context?: ThemeContext) => unknown;

/**
 * A resolver for values that may be variable references (`"$primary"`).
 * The last entry whose theme matches the active theme wins; with no match the
 * default theme is used. References to other variables are followed.
 * Non-references are returned as is; unknown variables resolve to `undefined`.
 */
export function createVariableResolver(doc: PenDocument): VariableResolver {
  const variables = isObject(doc.variables) ? doc.variables : {};
  const fallback = defaultTheme(doc);
  return (value, context = fallback) => {
    let current = value;
    for (let depth = 0; depth < MAX_CHAIN; depth++) {
      const name = variableName(current);
      if (name === undefined) return current;
      const definition = variables[name];
      if (!isObject(definition)) return undefined;
      const picked = pick(definition as VariableDefinition, context, fallback);
      if (!picked.found) return undefined;
      current = picked.value;
    }
    return undefined;
  };
}

/** One-off form of {@link createVariableResolver}. */
export const resolveValue = (doc: PenDocument, value: unknown, context?: ThemeContext): unknown =>
  createVariableResolver(doc)(value, context);
