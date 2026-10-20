import type { ExecResult, Screenshot } from './session.ts';

/** Warnings shown in full; the rest are counted. */
const MAX_WARNINGS = 20;
const LINE_WIDTH = 100;

export interface FormattedResult {
  text: string;
  /** One PNG per `TakeScreenshot` id, in order. */
  images: Screenshot[];
}

const plural = (n: number, word: string) => `${n} ${word}`;

/** Packs `items` into indented lines no wider than LINE_WIDTH. */
function wrap(items: readonly string[], separator = '  '): string[] {
  const lines: string[] = [];
  let line = '';
  for (const item of items) {
    if (line !== '' && line.length + separator.length + item.length > LINE_WIDTH) {
      lines.push(`  ${line}`);
      line = item;
    } else {
      line = line === '' ? item : `${line}${separator}${item}`;
    }
  }
  if (line !== '') lines.push(`  ${line}`);
  return lines;
}

/** The compact text answer of `execute` (06-agent-api §2) plus the screenshots. */
export function formatResult(result: ExecResult): FormattedResult {
  const ms = `${Math.round(result.ms)} ms`;
  const lines: string[] = [];

  if (!result.ok) {
    const error = result.error;
    const notRun = error?.name === 'EditError';
    const head = ['error', notRun ? 'not run' : 'rolled back'];
    if (result.editId !== undefined) head.push(`editId=${result.editId}`);
    lines.push(head.join(' · '));
    if (error) {
      lines.push(`  ${error.name}: ${error.message}`);
      if (error.line !== undefined) {
        lines.push(
          error.source ? `  at line ${error.line}:  ${error.source}` : `  at line ${error.line}`,
        );
      }
      if (error.hint) lines.push(`hint: ${error.hint}`);
    }
    return { text: lines.join('\n'), images: [] };
  }

  const { counts } = result;
  const head = [
    'ok',
    plural(counts.inserted, 'inserted'),
    plural(counts.updated, 'updated'),
    plural(counts.deleted, 'deleted'),
  ];
  if (counts.replaced > 0) head.push(plural(counts.replaced, 'replaced'));
  if (counts.moved > 0) head.push(plural(counts.moved, 'moved'));
  if (counts.variables > 0) head.push('variables set');
  head.push(ms);
  lines.push(head.join(' · '));

  if (result.names.length > 0) {
    lines.push('names:', ...wrap(result.names.map(([name, id]) => `${name}=${id}`)));
  }
  if (result.prints.length > 0) {
    lines.push('print:', ...result.prints.map((line) => `  ${line.replaceAll('\n', '\n  ')}`));
  }
  if (result.exported.length > 0) {
    lines.push('exported:', ...result.exported.map((file) => `  ${file}`));
  }
  if (result.warnings.length > 0) {
    lines.push('warnings:');
    for (const warning of result.warnings.slice(0, MAX_WARNINGS)) {
      lines.push(`  [${warning.code}] ${warning.message}`);
    }
    const more = result.warnings.length - MAX_WARNINGS;
    if (more > 0) lines.push(`  … and ${more} more`);
  }
  return { text: lines.join('\n'), images: result.screenshots };
}
