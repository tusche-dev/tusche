import { relative } from 'node:path';
import type { DocumentSession } from '@tusche/exec';
import { indexNodes, type PenDocument } from '@tusche/pen-format';

/** Lines listed per section before the rest is only counted. */
const MAX_LINES = 40;

/** A path relative to `cwd` when it is inside it, otherwise absolute. */
export function displayPath(file: string, cwd: string): string {
  const rel = relative(cwd, file);
  return rel !== '' && !rel.startsWith('..') && !/^[a-z]:/i.test(rel)
    ? rel.split('\\').join('/')
    : file;
}

const size = (value: unknown) =>
  typeof value === 'number' ? String(Math.round(value)) : typeof value === 'string' ? value : '?';

function section(title: string, items: string[]): string[] {
  if (items.length === 0) return [];
  const lines = [`${title}:`, ...items.slice(0, MAX_LINES).map((item) => `  ${item}`)];
  if (items.length > MAX_LINES) lines.push(`  … ${items.length - MAX_LINES} more`);
  return lines;
}

/** Top-level nodes, components, variables and themes of a document. */
export function documentSummary(doc: PenDocument): string[] {
  const top = doc.children.map((node) => {
    const name = typeof node.name === 'string' ? ` "${node.name}"` : '';
    const reusable = node.reusable === true ? ' component' : '';
    return `${node.id}${name} ${node.type}${reusable} ${size(node.width)}×${size(node.height)}`;
  });
  const components: string[] = [];
  for (const node of indexNodes(doc).values()) {
    if (node.reusable !== true) continue;
    components.push(typeof node.name === 'string' ? `${node.id} "${node.name}"` : node.id);
  }
  const variables = Object.keys(doc.variables ?? {});
  const themes = Object.entries(doc.themes ?? {}).map(
    ([axis, values]) => `${axis}=${(values as string[]).join('|')}`,
  );
  const lines = [
    ...section(`top-level (${top.length})`, top),
    ...section(`components (${components.length})`, components),
  ];
  if (variables.length > 0) {
    const shown = variables.slice(0, MAX_LINES).join(', ');
    lines.push(
      `variables (${variables.length}): ${shown}${variables.length > MAX_LINES ? ', …' : ''}`,
    );
  }
  if (themes.length > 0) lines.push(`themes: ${themes.join('  ')}`);
  if (top.length === 0) lines.push('the document is empty');
  return lines;
}

/** One line about an open session: path, flags, history. */
export function sessionLine(session: DocumentSession, cwd: string, active: boolean): string {
  const flags = [`${session.doc.children.length} top-level`];
  if (session.dirty) flags.push('unsaved');
  if (session.conflict) flags.push('CONFLICT: changed on disk');
  if (session.saveError) flags.push(`save failed: ${session.saveError}`);
  flags.push(`undo ${session.undoDepth}`, `redo ${session.redoDepth}`);
  return `${active ? '* ' : '  '}${displayPath(session.filePath, cwd)} · ${flags.join(' · ')}`;
}
