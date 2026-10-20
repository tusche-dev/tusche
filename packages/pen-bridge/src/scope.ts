import type { ThemeContext, VariableResolver } from '@tusche/pen-format';

export type WarningCode =
  | 'stub'
  | 'unsupported'
  | 'approximated'
  | 'missing-asset'
  | 'unknown-icon'
  | 'unknown-ref'
  | 'circular-size'
  | 'depth-limit';

/** Something the projection could not show exactly as pen.dev would. */
export interface ProjectionWarning {
  code: WarningCode;
  message: string;
  /** Pen path of the node: an id or `instanceId/childId/…`. */
  path: string;
}

/**
 * Values of one node: resolves `$variables` for the node's theme and reports
 * warnings against the node's pen path.
 */
export class Scope {
  constructor(
    readonly path: string,
    readonly theme: ThemeContext,
    private readonly resolver: VariableResolver,
    private readonly warnings: ProjectionWarning[],
  ) {}

  value(value: unknown): unknown {
    return this.resolver(value, this.theme);
  }

  num(value: unknown, fallback: number): number;
  num(value: unknown, fallback?: number): number | undefined;
  num(value: unknown, fallback?: number): number | undefined {
    const resolved = this.value(value);
    return typeof resolved === 'number' && Number.isFinite(resolved) ? resolved : fallback;
  }

  bool(value: unknown, fallback: boolean): boolean {
    const resolved = this.value(value);
    return typeof resolved === 'boolean' ? resolved : fallback;
  }

  str(value: unknown): string | undefined {
    const resolved = this.value(value);
    return typeof resolved === 'string' ? resolved : undefined;
  }

  warn(code: WarningCode, message: string): void {
    this.warnings.push({ code, message, path: this.path });
  }

  child(path: string, theme: ThemeContext = this.theme): Scope {
    return new Scope(path, theme, this.resolver, this.warnings);
  }
}
