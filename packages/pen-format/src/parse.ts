import { type Node, type ParseError, parseTree, printParseErrorCode } from 'jsonc-parser';
import { setKeyOrder } from './key-order.ts';
import type { PenDocument } from './types.ts';

/** How a file was written, so it can be written back the same way (ADR-006). */
export interface PenFormat {
  /** One level of indentation; `''` means a single-line file. */
  indent: string;
  eol: '\n' | '\r\n';
  finalNewline: boolean;
  bom: boolean;
}

/** How pen.dev writes new files: two spaces, LF, no trailing newline. */
export const DEFAULT_FORMAT: Readonly<PenFormat> = Object.freeze({
  indent: '  ',
  eol: '\n',
  finalNewline: false,
  bom: false,
});

export interface ParsedPen {
  /** The document as read; not validated and not migrated. */
  doc: PenDocument;
  format: PenFormat;
  /** True when the file used JSONC features (comments, trailing commas). */
  jsonc: boolean;
}

export class PenParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number,
    readonly offset: number,
  ) {
    super(`${message} at line ${line}, column ${column}`);
    this.name = 'PenParseError';
  }
}

export function detectFormat(text: string): PenFormat {
  const bom = text.charCodeAt(0) === 0xfeff;
  const body = bom ? text.slice(1) : text;
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const finalNewline = body.endsWith('\n');
  const indentMatch = /\n([ \t]+)\S/.exec(body);
  const indent = indentMatch
    ? (indentMatch[1] as string)
    : body.trimEnd().includes('\n')
      ? DEFAULT_FORMAT.indent
      : '';
  return { indent, eol, finalNewline, bom };
}

const ARRAY_INDEX_RE = /^(?:0|[1-9]\d*)$/;
/** JavaScript lists integer-like keys first, whatever the source order was. */
const isIndexLike = (key: string): boolean => ARRAY_INDEX_RE.test(key) && Number(key) < 4294967295;

/** Records the key order of every object; false if some order cannot be trusted. */
function recordOrder(root: unknown): boolean {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (const item of value) if (typeof item === 'object' && item !== null) stack.push(item);
    } else if (typeof value === 'object' && value !== null) {
      const keys = Object.keys(value);
      if (keys.some(isIndexLike)) return false;
      setKeyOrder(value, keys);
      for (const key of keys) {
        const item = (value as Record<string, unknown>)[key];
        if (typeof item === 'object' && item !== null) stack.push(item);
      }
    }
  }
  return true;
}

/** Builds plain values from a JSONC syntax tree, recording the exact key order. */
function fromTree(node: Node): unknown {
  switch (node.type) {
    case 'object': {
      const object: Record<string, unknown> = {};
      const keys: string[] = [];
      for (const property of node.children ?? []) {
        const [keyNode, valueNode] = property.children ?? [];
        if (!keyNode || !valueNode) continue;
        const key = keyNode.value as string;
        if (!Object.hasOwn(object, key)) keys.push(key);
        // defineProperty: a "__proto__" key must stay an ordinary property.
        Object.defineProperty(object, key, {
          value: fromTree(valueNode),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      setKeyOrder(object, keys);
      return object;
    }
    case 'array':
      return (node.children ?? []).map(fromTree);
    default:
      return node.value;
  }
}

function position(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

function parseJsonc(text: string): unknown {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });
  const error = errors[0];
  if (error || !tree) {
    const offset = error?.offset ?? 0;
    const { line, column } = position(text, offset);
    throw new PenParseError(
      error ? `Invalid JSON: ${printParseErrorCode(error.error)}` : 'Empty file',
      line,
      column,
      offset,
    );
  }
  return fromTree(tree);
}

/**
 * Reads a `.pen` file. Accepts JSON with comments and trailing commas.
 * Remembers the formatting and key order for `serializePen`.
 * Throws `PenParseError` with a line and column on invalid input.
 */
export function parsePen(text: string): ParsedPen {
  const format = detectFormat(text);
  const body = format.bom ? text.slice(1) : text;
  let doc: unknown;
  let jsonc = false;
  try {
    doc = JSON.parse(body);
    if (!recordOrder(doc)) doc = parseJsonc(body);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    doc = parseJsonc(body);
    jsonc = true;
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new PenParseError('A .pen document must be a JSON object', 1, 1, 0);
  }
  return { doc: doc as PenDocument, format, jsonc };
}
