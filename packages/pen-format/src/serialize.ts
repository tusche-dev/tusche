import { orderedKeys } from './key-order.ts';
import { DEFAULT_FORMAT, type PenFormat } from './parse.ts';

/**
 * Writes a document the way `JSON.stringify(doc, null, indent)` would, but
 * with the key order and file formatting kept from the source (ADR-006).
 * A file read with `parsePen` and written back unchanged is byte-identical.
 */
export function serializePen(doc: object, format: Partial<PenFormat> = {}): string {
  const { indent, eol, finalNewline, bom } = { ...DEFAULT_FORMAT, ...format };
  const separator = indent === '' ? ':' : ': ';

  const write = (value: unknown, current: string, isRoot: boolean): string | undefined => {
    switch (typeof value) {
      case 'string':
        return JSON.stringify(value);
      case 'number':
        return Number.isFinite(value) ? JSON.stringify(value) : 'null';
      case 'boolean':
        return value ? 'true' : 'false';
      case 'object':
        break;
      default:
        return undefined; // undefined, functions and symbols are skipped, as in JSON.stringify
    }
    if (value === null) return 'null';
    const inner = current + indent;
    const open = indent === '' ? '' : `\n${inner}`;
    const join = indent === '' ? ',' : `,\n${inner}`;
    const close = indent === '' ? '' : `\n${current}`;

    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      const items = value.map((item) => write(item, inner, false) ?? 'null');
      return `[${open}${items.join(join)}${close}]`;
    }

    const object = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of orderedKeys(object, isRoot)) {
      const written = write(object[key], inner, false);
      if (written !== undefined) parts.push(`${JSON.stringify(key)}${separator}${written}`);
    }
    if (parts.length === 0) return '{}';
    return `{${open}${parts.join(join)}${close}}`;
  };

  let text = write(doc, '', true) ?? 'null';
  if (eol === '\r\n') text = text.replaceAll('\n', '\r\n');
  if (finalNewline) text += eol;
  return bom ? `﻿${text}` : text;
}
