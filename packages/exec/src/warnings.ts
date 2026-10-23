import type { Scene } from '@tusche/engine';
import type { Diagnostic, PenExtra } from '@tusche/pen-format';

/** A warning in the response: the call succeeded, but something probably needs a look. */
export interface ExecWarning {
  /** Code from the catalog in 06-agent-api (`clipped`, `id-ignored`, …). */
  code: string;
  message: string;
  /** Path of the node the warning is about. */
  path?: string;
}

/** Validator codes under the names of the warning catalog. */
const CODES: Readonly<Record<string, string>> = {
  'text-without-fill': 'invisible-text',
};

/** Warnings of the validator about a node an operation wrote (infos are dropped). */
export function fromDiagnostics(
  diagnostics: readonly Diagnostic[],
  path: string | undefined,
): ExecWarning[] {
  return diagnostics
    .filter((d) => d.level === 'warning' || d.code === 'unknown-property')
    .map((d) => {
      const warning: ExecWarning = { code: CODES[d.code] ?? d.code, message: d.message };
      const where = d.nodeId ?? path;
      if (where !== undefined) warning.path = where;
      return warning;
    });
}

/** Projection warnings worth showing to the agent, under catalog names. */
const PROJECTION_CODES: Readonly<Record<string, string>> = {
  stub: 'unsupported-render',
  unsupported: 'unsupported-render',
  'missing-asset': 'missing-asset',
  'unknown-icon': 'unknown-icon',
  'unknown-ref': 'unknown-ref',
  'depth-limit': 'depth-limit',
};

export interface WarningSource {
  /** Node at a path as agents see it (instances expanded). */
  node(path: string): PenExtra | undefined;
  /** Parent of a node of the tree; `undefined` at the top level and inside instances. */
  parent(path: string): PenExtra | undefined;
  scene: Scene;
}

const label = (source: WarningSource, path: string): string => {
  const name = source.node(path)?.name;
  return typeof name === 'string' ? `"${name}" (${path})` : path;
};

/**
 * Warnings about the nodes a call created or changed, checked after the commit on the
 * laid-out scene. Only `touched` nodes are checked: old problems of the file stay quiet.
 */
export function afterCommit(
  source: WarningSource,
  touched: ReadonlySet<string>,
  missingFonts: Iterable<string>,
): ExecWarning[] {
  const warnings: ExecWarning[] = [];
  const { scene } = source;
  for (const path of touched) {
    const node = source.node(path);
    if (!node) continue;
    const parent = source.parent(path);
    if (
      parent?.type === 'frame' &&
      (parent.layout ?? 'horizontal') !== 'none' &&
      node.layoutPosition !== 'absolute' &&
      (typeof node.x === 'number' || typeof node.y === 'number')
    ) {
      warnings.push({
        code: 'ignored-xy',
        message: `${label(source, path)} has x/y, but its parent lays children out in a ${parent.layout ?? 'horizontal'} flow; set layoutPosition:"absolute" or layout:"none" on the parent`,
        path,
      });
    }
    const root = scene.projection.rootOf(path);
    if (root === undefined || !scene.isLaidOut(root)) continue;
    const clipping = scene.clippingSync(path);
    // Content below the fold of a scroll area and decoration bleeding over an edge are meant.
    if (clipping && !clipping.intended) {
      warnings.push({
        code: 'clipped',
        message: `${label(source, path)} is ${clipping.state} by ${label(source, clipping.by)}`,
        path,
      });
    }
    if (node.type === 'frame' && node.enabled !== false) {
      const box = scene.boundsSync(path);
      if (box && (box.width <= 0 || box.height <= 0)) {
        warnings.push({
          code: 'zero-size',
          message: `${label(source, path)} collapsed to ${Math.round(box.width)}×${Math.round(box.height)}`,
          path,
        });
      }
    }
  }
  for (const font of missingFonts) {
    warnings.push({
      code: 'unknown-font',
      message: `Font "${font}" was not found; a fallback was used`,
    });
  }
  const roots = new Set<string>();
  for (const path of touched) {
    const root = scene.projection.rootOf(path);
    if (root !== undefined) roots.add(root);
  }
  for (const glyphs of scene.missingGlyphs(roots)) {
    if (!touched.has(glyphs.path)) continue;
    const sample = [...glyphs.characters].slice(0, 12).join('');
    warnings.push({
      code: 'missing-glyphs',
      message: `${label(source, glyphs.path)}: font "${glyphs.family}" has no glyphs for "${sample}"; they are drawn in a fallback font. Pick a font that covers this script`,
      path: glyphs.path,
    });
  }
  for (const warning of scene.warnings) {
    const code = PROJECTION_CODES[warning.code];
    if (code === undefined || !touched.has(warning.path)) continue;
    warnings.push({ code, message: warning.message, path: warning.path });
  }
  return warnings;
}

/** Drops repeated warnings (same code, path and message), keeping the first. */
export function dedupe(warnings: readonly ExecWarning[]): ExecWarning[] {
  const seen = new Set<string>();
  return warnings.filter((w) => {
    const key = `${w.code}\0${w.path ?? ''}\0${w.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
