/** The schema version Tusche writes and validates against. */
export const CURRENT_VERSION = '2.21';

export interface Version {
  major: number;
  minor: number;
}

export function parseVersion(version: unknown): Version | undefined {
  if (typeof version !== 'string') return undefined;
  const match = /^(\d+)\.(\d+)$/.exec(version);
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/** Negative if `a < b`, zero if equal, positive if `a > b`. Both must be valid versions. */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) throw new Error(`Invalid .pen version: ${va ? b : a}`);
  return va.major - vb.major || va.minor - vb.minor;
}
