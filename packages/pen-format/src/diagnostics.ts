export type DiagnosticLevel = 'error' | 'warning' | 'info';

export type DiagnosticCode =
  // errors
  | 'schema'
  | 'invalid-id'
  | 'duplicate-id'
  | 'layout-on-non-frame'
  | 'unsupported-version'
  // warnings
  | 'newer-version'
  | 'unknown-node-type'
  | 'unknown-ref'
  | 'unknown-descendant'
  | 'unknown-variable'
  | 'unknown-theme'
  | 'text-without-fill'
  | 'circular-size'
  // info
  | 'explicit-default'
  | 'unknown-property'
  // migrations
  | 'migration';

export interface Diagnostic {
  level: DiagnosticLevel;
  code: DiagnosticCode;
  message: string;
  /** JSON path inside the document, e.g. `$.children[3].children[0].fill`. */
  path: string;
  /** Id of the closest node, when there is one. */
  nodeId?: string;
}

export const hasErrors = (diagnostics: readonly Diagnostic[]): boolean =>
  diagnostics.some((d) => d.level === 'error');

/** One line per diagnostic: `error schema $.children[0] (id abc): message`. */
export function formatDiagnostic(d: Diagnostic): string {
  const where = d.nodeId === undefined ? d.path : `${d.path} (id ${d.nodeId})`;
  return `${d.level} ${d.code} ${where}: ${d.message}`;
}
