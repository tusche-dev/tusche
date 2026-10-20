/**
 * Checks real .pen files: parse, validate, round trip, migrate.
 * Paths come from the command line, nothing is written to disk.
 *
 *   bun packages/pen-format/scripts/check-files.ts design/*.pen [--verbose]
 */
import { readFileSync } from 'node:fs';
import {
  type Diagnostic,
  formatDiagnostic,
  migratePen,
  parsePen,
  serializePen,
  validatePen,
} from '../src/index.ts';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const files = args.filter((arg) => !arg.startsWith('--'));
if (files.length === 0) {
  console.error('usage: bun packages/pen-format/scripts/check-files.ts <file.pen>... [--verbose]');
  process.exit(2);
}

const summarize = (diagnostics: readonly Diagnostic[]): string => {
  const counts = new Map<string, number>();
  for (const d of diagnostics) {
    const key = `${d.level}:${d.code}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, n]) => `${key}×${n}`).join(', ') || 'clean';
};

const ms = (start: number): string => `${(performance.now() - start).toFixed(0)} ms`;

let failed = false;
for (const file of files) {
  console.log(`\n${file}`);
  const raw = readFileSync(file, 'utf8');
  console.log(
    `  size        ${raw.length < 10240 ? `${raw.length} B` : `${(raw.length / 1024).toFixed(0)} KB`}`,
  );
  let start = performance.now();
  let parsed: ReturnType<typeof parsePen>;
  try {
    parsed = parsePen(raw);
  } catch (error) {
    failed = true;
    console.log(`  parse       FAILED: ${(error as Error).message}`);
    continue;
  }
  const { doc, format } = parsed;
  console.log(
    `  parse       ${ms(start)}; version ${doc.version}; ${format.eol === '\r\n' ? 'CRLF' : 'LF'}, indent ${JSON.stringify(format.indent)}, final newline ${format.finalNewline}${parsed.jsonc ? ', JSONC' : ''}`,
  );

  start = performance.now();
  const before = validatePen(doc);
  console.log(`  validate    ${ms(start)}; ${summarize(before)}`);

  start = performance.now();
  const written = serializePen(doc, format);
  const identical = written === raw;
  if (!identical) failed = true;
  console.log(`  round trip  ${ms(start)}; ${identical ? 'byte-identical' : 'DIFFERS'}`);

  const migration = migratePen(doc);
  const after = validatePen(doc);
  const migrated = serializePen(doc, format);
  const reparsed = parsePen(migrated);
  const stable = serializePen(reparsed.doc, reparsed.format) === migrated;
  if (!stable || after.some((d) => d.level === 'error')) failed = true;
  console.log(
    `  migrate     ${migration.from} → ${migration.to}; applied: ${migration.applied.join(', ') || 'none'}; after: ${summarize(after)}; rewrite stable: ${stable}`,
  );
  if (verbose) {
    for (const d of [...migration.diagnostics, ...after]) {
      if (d.level !== 'info' || d.code === 'migration') console.log(`    ${formatDiagnostic(d)}`);
    }
  }
}
process.exit(failed ? 1 : 0);
