import type { LintPreset } from '@tusche/engine';
import { type DiagnosticLevel, indexNodes, validatePen } from '@tusche/pen-format';
import { Reader } from './api/reads.ts';
import type { DocumentSession } from './session.ts';
import { Transaction } from './transaction.ts';
import { childrenOf } from './tree.ts';
import { afterCommit, dedupe, fromDiagnostics } from './warnings.ts';

/** One finding of `lint`: the validator, the checks of `execute` and the OpenPencil linter. */
export interface LintIssue {
  level: DiagnosticLevel;
  /**
   * A code of the warning catalog (06-agent-api §3), a validator code, or `op/<rule>` for
   * rules of the OpenPencil linter.
   */
  code: string;
  message: string;
  /** Pen path of the node. */
  path?: string;
}

export interface LintDocumentOptions {
  /** Check only this node and its subtree. */
  path?: string;
  /** Include `info` findings (style suggestions). Default `false`. */
  info?: boolean;
  /** Rule set of the OpenPencil linter. Default `recommended`. */
  preset?: LintPreset;
}

const ORDER: Record<DiagnosticLevel, number> = { error: 0, warning: 1, info: 2 };

/**
 * Lints a whole document (or one subtree) of an open session: schema errors, the warnings
 * `execute` gives for nodes it touched — here for every node — and OpenPencil rules.
 * Throws for an unknown `path`.
 */
export async function lintDocument(
  session: DocumentSession,
  options: LintDocumentOptions = {},
): Promise<LintIssue[]> {
  const doc = session.doc;
  const tx = new Transaction(doc);
  const reader = new Reader(tx, session.scene);
  const index = indexNodes(doc);

  let paths: Set<string>;
  if (options.path === undefined) {
    paths = new Set(index.keys());
  } else {
    const start = reader.node(options.path);
    if (!start) throw new Error(`no node at "${options.path}"`);
    paths = new Set([options.path]);
    if (!options.path.includes('/')) {
      const stack = [...childrenOf(start)];
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node || typeof node.id !== 'string') continue;
        paths.add(node.id);
        if (node.type !== 'ref') stack.push(...childrenOf(node));
      }
    }
  }

  const issues: LintIssue[] = [];
  const keep = (level: DiagnosticLevel) => level !== 'info' || options.info === true;

  // The validator: errors as they are; warnings under the catalog names `execute` uses.
  for (const d of validatePen(doc, { explicitDefaults: false })) {
    if (options.path !== undefined && (d.nodeId === undefined || !paths.has(d.nodeId))) continue;
    if (!keep(d.level)) continue;
    if (d.level === 'error') {
      const issue: LintIssue = { level: 'error', code: d.code, message: d.message };
      issue.path = d.nodeId ?? d.path;
      issues.push(issue);
      continue;
    }
    for (const w of fromDiagnostics([d], undefined)) issues.push({ level: d.level, ...w });
  }

  // The checks `execute` runs after a commit, on every node.
  const roots = new Set<string>();
  for (const path of paths) {
    const root = session.scene.projection.rootOf(path);
    if (root !== undefined) roots.add(root);
  }
  await reader.layout(roots);
  const source = {
    node: (p: string) => reader.node(p),
    parent: (p: string) => reader.parent(p),
    scene: session.scene,
  };
  for (const w of afterCommit(source, paths, reader.missingFonts)) {
    issues.push({ level: 'warning', ...w });
  }

  // OpenPencil rules.
  const linted = options.path === undefined ? undefined : [options.path];
  const preset = options.preset === undefined ? {} : { preset: options.preset };
  for (const m of await session.scene.lint(linted, preset)) {
    if (!keep(m.severity)) continue;
    const message = m.suggest ? `${m.message} (${m.suggest})` : m.message;
    issues.push({ level: m.severity, code: `op/${m.ruleId}`, message, path: m.path });
  }

  const unique = dedupe(issues) as LintIssue[];
  return unique
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) => ORDER[a.issue.level] - ORDER[b.issue.level] || a.i - b.i)
    .map(({ issue }) => issue);
}

/** Counts of findings by level. */
export function lintCounts(issues: readonly LintIssue[]): Record<DiagnosticLevel, number> {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.level]++;
  return counts;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Text report: a summary line, then one line per finding. */
export function formatLint(issues: readonly LintIssue[]): string {
  const counts = lintCounts(issues);
  const head = `lint · ${plural(counts.error, 'error')} · ${plural(counts.warning, 'warning')}${
    counts.info > 0 ? ` · ${counts.info} info` : ''
  }`;
  const lines = [head];
  for (const issue of issues) {
    const where = issue.path === undefined ? '' : ` ${issue.path}:`;
    lines.push(`  ${issue.level} [${issue.code}]${where} ${issue.message}`);
  }
  return lines.join('\n');
}
