import type { Diagnostic } from '@tusche/pen-format';

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
