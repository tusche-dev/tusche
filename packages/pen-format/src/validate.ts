import * as v from 'valibot';
import type { Diagnostic, DiagnosticCode, DiagnosticLevel } from './diagnostics.ts';
import {
  componentRoot,
  indexNodes,
  type NodeIndex,
  resolveInInstance,
  splitIdPath,
} from './paths.ts';
import { documentRoot } from './schema/document.ts';
import {
  isKnownNodeType,
  KNOWN_KEYS,
  type KnownNodeType,
  LAYOUT_KEYS,
  NODE_SCHEMAS,
  OVERRIDE_SCHEMAS,
} from './schema/nodes.ts';
import type { PenDocument, PenExtra, RefNode } from './types.ts';
import { CURRENT_VERSION, compareVersions, parseVersion } from './version.ts';

export interface ValidateOptions {
  /** Report explicitly written default values (level `info`). Default `true`. */
  explicitDefaults?: boolean;
  /** Report properties the schema does not know (level `info`). Default `true`. */
  unknownProperties?: boolean;
}

const ROOT_KEYS = new Set(['version', 'themes', 'imports', 'variables', 'children']);

/** Default values that are redundant when written explicitly on a node. */
const DEFAULTS: Record<string, Record<string, unknown>> = {
  '*': {
    reusable: false,
    enabled: true,
    opacity: 1,
    rotation: 0,
    flipX: false,
    flipY: false,
    layoutPosition: 'auto',
  },
  frame: {
    clip: false,
    layout: 'horizontal',
    gap: 0,
    justifyContent: 'start',
    alignItems: 'start',
    width: 'fit_content',
    height: 'fit_content',
    placeholder: false,
  },
  text: { textGrowth: 'auto' },
  ellipse: { innerRadius: 0, startAngle: 0, sweepAngle: 360 },
  path: { fillRule: 'nonzero' },
  script: { clip: false },
  browser: { zoom: 1 },
};

/** Keys whose string values are never variable references. */
const NON_VARIABLE_KEYS = new Set([
  'id',
  'type',
  'ref',
  'name',
  'context',
  'metadata',
  'href',
  'url',
  'geometry',
  'scriptUri',
  'theme',
  'children',
  'descendants',
  'content',
]);

/** In text content a leading `$` is only treated as a reference when it looks like a name. */
const CONTENT_VARIABLE_RE = /^\$[A-Za-z_][\w.-]*$/;

const isObject = (value: unknown): value is PenExtra =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;
const joinKey = (path: string, key: string | number): string =>
  typeof key === 'number'
    ? `${path}[${key}]`
    : IDENTIFIER_RE.test(key)
      ? `${path}.${key}`
      : `${path}[${JSON.stringify(key)}]`;

type Issue = v.BaseIssue<unknown>;

type PathKey = string | number;

interface Leaf {
  issue: Issue;
  /** Full path from the validated value; nested union issues are relative to the union. */
  keys: PathKey[];
}

const pathKeys = (issue: Issue): PathKey[] =>
  (issue.path ?? []).map((item) => {
    const key = (item as { key: unknown }).key;
    return typeof key === 'number' ? key : String(key);
  });

/** Unions report one vague issue; prefer the most specific nested ones. */
function leafIssues(issue: Issue, prefix: PathKey[] = []): Leaf[] {
  const keys = [...prefix, ...pathKeys(issue)];
  if (!issue.issues || issue.issues.length === 0) return [{ issue, keys }];
  const leaves = issue.issues.flatMap((nested) => leafIssues(nested, keys));
  const deepest = Math.max(...leaves.map((leaf) => leaf.keys.length));
  if (deepest <= keys.length) return [{ issue, keys }];
  const seen = new Set<string>();
  return leaves.filter((leaf) => {
    if (leaf.keys.length !== deepest) return false;
    const id = `${leaf.keys.join('.')}|${leaf.issue.message}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

const describe = (value: unknown): string => {
  const text = JSON.stringify(value);
  if (text === undefined) return String(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
};

class Validator {
  readonly diagnostics: Diagnostic[] = [];
  readonly index: NodeIndex;
  private readonly schemaLevel: DiagnosticLevel;
  private readonly variables: ReadonlySet<string>;
  private readonly themes: Readonly<Record<string, string[]>>;

  constructor(
    readonly doc: PenDocument,
    readonly options: Required<ValidateOptions>,
    index?: NodeIndex,
  ) {
    this.index = index ?? indexNodes(doc);
    const version = parseVersion(doc.version);
    const newer = version !== undefined && compareVersions(doc.version, CURRENT_VERSION) > 0;
    // A newer file may use things we do not know yet: keep it editable, just warn.
    this.schemaLevel = newer ? 'warning' : 'error';
    this.variables = new Set(isObject(doc.variables) ? Object.keys(doc.variables) : []);
    this.themes = isObject(doc.themes) ? (doc.themes as Record<string, string[]>) : {};
  }

  report(
    level: DiagnosticLevel,
    code: DiagnosticCode,
    path: string,
    message: string,
    nodeId?: unknown,
  ) {
    const diagnostic: Diagnostic = { level, code, message, path };
    if (typeof nodeId === 'string') diagnostic.nodeId = nodeId;
    this.diagnostics.push(diagnostic);
  }

  schemaIssues(issues: readonly Issue[], basePath: string, nodeId?: unknown) {
    for (const { issue, keys } of issues.flatMap((issue) => leafIssues(issue))) {
      const path = keys.reduce<string>(joinKey, basePath);
      const message = issue.message.includes('received')
        ? issue.message
        : `${issue.message} (got ${describe(issue.input)})`;
      this.report(this.schemaLevel, 'schema', path, message, nodeId);
    }
  }

  run() {
    const doc = this.doc;
    const root = v.safeParse(documentRoot, doc);
    if (!root.success) this.schemaIssues(root.issues, '$');
    this.checkVersion();
    if (this.options.unknownProperties) {
      for (const key of Object.keys(doc)) {
        if (!ROOT_KEYS.has(key)) {
          this.report(
            'info',
            'unknown-property',
            joinKey('$', key),
            `Unknown document property "${key}" is kept as is`,
          );
        }
      }
    }
    this.checkIds();
    this.checkVariables();
    if (Array.isArray(doc.children)) {
      doc.children.forEach((child, i) => {
        this.node(child, joinKey('$.children', i), 'tree');
      });
    }
  }

  checkVersion() {
    const version = parseVersion(this.doc.version);
    if (!version) return; // reported by the schema
    if (version.major !== 2) {
      this.report(
        version.major > 2 ? 'warning' : 'error',
        version.major > 2 ? 'newer-version' : 'unsupported-version',
        '$.version',
        `Version ${this.doc.version} is not a 2.x schema; Tusche supports 2.x and writes ${CURRENT_VERSION}`,
      );
    } else if (compareVersions(this.doc.version, CURRENT_VERSION) > 0) {
      this.report(
        'warning',
        'newer-version',
        '$.version',
        `Version ${this.doc.version} is newer than ${CURRENT_VERSION}; unknown properties are kept, schema problems are reported as warnings`,
      );
    }
  }

  checkIds() {
    const seen = new Map<string, string>();
    const visit = (node: unknown, path: string) => {
      if (!isObject(node)) return;
      const id = node.id;
      if (typeof id === 'string') {
        if (id.includes('/')) {
          this.report(
            'error',
            'invalid-id',
            joinKey(path, 'id'),
            `Id "${id}" must not contain "/": it separates ids in instance paths`,
            id,
          );
        }
        const first = seen.get(id);
        if (first !== undefined) {
          this.report(
            'error',
            'duplicate-id',
            joinKey(path, 'id'),
            `Id "${id}" is already used at ${first}`,
            id,
          );
        } else {
          seen.set(id, path);
        }
      }
      if (Array.isArray(node.children)) {
        node.children.forEach((child, i) => {
          visit(child, joinKey(joinKey(path, 'children'), i));
        });
      }
    };
    if (Array.isArray(this.doc.children)) {
      this.doc.children.forEach((child, i) => {
        visit(child, joinKey('$.children', i));
      });
    }
  }

  checkVariables() {
    const variables = this.doc.variables;
    if (!isObject(variables)) return;
    for (const [name, definition] of Object.entries(variables)) {
      if (!isObject(definition)) continue;
      this.variableRefs(
        definition.value,
        joinKey(joinKey(joinKey('$', 'variables'), name), 'value'),
      );
      if (Array.isArray(definition.value)) {
        definition.value.forEach((entry, i) => {
          if (isObject(entry)) {
            this.theme(
              entry.theme,
              joinKey(joinKey(joinKey(joinKey('$', 'variables'), name), 'value'), i),
            );
          }
        });
      }
    }
  }

  /** Reports `$name` strings that do not name a variable. */
  variableRefs(value: unknown, path: string, nodeId?: unknown) {
    if (typeof value === 'string') {
      if (value.startsWith('$') && value.length > 1) {
        const name = value.slice(1);
        // `alias:name` points into an imported library; checked when imports are supported.
        if (!name.includes(':') && !this.variables.has(name)) {
          this.report(
            'warning',
            'unknown-variable',
            path,
            `Variable "${value}" is not defined in "variables"`,
            nodeId,
          );
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        this.variableRefs(item, joinKey(path, i), nodeId);
      });
      return;
    }
    if (isObject(value)) {
      for (const [key, item] of Object.entries(value)) {
        if (key === 'theme') continue;
        this.variableRefs(item, joinKey(path, key), nodeId);
      }
    }
  }

  theme(theme: unknown, path: string, nodeId?: unknown) {
    if (!isObject(theme)) return;
    for (const [axis, value] of Object.entries(theme)) {
      const values = this.themes[axis];
      if (!Array.isArray(values)) {
        this.report(
          'warning',
          'unknown-theme',
          joinKey(joinKey(path, 'theme'), axis),
          `Theme axis "${axis}" is not declared in "themes"`,
          nodeId,
        );
      } else if (typeof value === 'string' && !values.includes(value)) {
        this.report(
          'warning',
          'unknown-theme',
          joinKey(joinKey(path, 'theme'), axis),
          `Theme value "${value}" is not one of ${values.map((x) => `"${x}"`).join(', ')}`,
          nodeId,
        );
      }
    }
  }

  /** Property checks shared by nodes, instance roots and overrides. */
  properties(
    node: PenExtra,
    type: KnownNodeType,
    path: string,
    nodeId: unknown,
    ownKeys: ReadonlySet<string>,
  ) {
    if (type !== 'frame') {
      for (const key of Object.keys(node)) {
        if (LAYOUT_KEYS.has(key)) {
          this.report(
            'error',
            'layout-on-non-frame',
            joinKey(path, key),
            `"${key}" is a layout property and only works on frames, not on ${type}`,
            nodeId,
          );
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (NON_VARIABLE_KEYS.has(key)) {
        if (key === 'content' && typeof value === 'string' && CONTENT_VARIABLE_RE.test(value)) {
          this.variableRefs(value, joinKey(path, key), nodeId);
        }
        continue;
      }
      this.variableRefs(value, joinKey(path, key), nodeId);
    }
    this.theme(node.theme, path, nodeId);
    if (this.options.unknownProperties) {
      for (const key of Object.keys(node)) {
        if (!ownKeys.has(key) && !LAYOUT_KEYS.has(key)) {
          this.report(
            'info',
            'unknown-property',
            joinKey(path, key),
            `Unknown property "${key}" on ${type} is kept as is`,
            nodeId,
          );
        }
      }
    }
  }

  node(node: unknown, path: string, scope: 'tree' | 'replacement') {
    if (!isObject(node)) {
      this.report(
        this.schemaLevel,
        'schema',
        path,
        `Expected a node object (got ${describe(node)})`,
      );
      return;
    }
    const { type, id } = node;
    if (!isKnownNodeType(type)) {
      this.report(
        typeof type === 'string' ? 'warning' : this.schemaLevel,
        typeof type === 'string' ? 'unknown-node-type' : 'schema',
        joinKey(path, 'type'),
        typeof type === 'string'
          ? `Unknown node type "${type}"; it is kept as is but not checked`
          : 'Every node needs a "type"',
        id,
      );
      this.children(node, path, scope);
      return;
    }

    const result = v.safeParse(NODE_SCHEMAS[type], node);
    if (!result.success) this.schemaIssues(result.issues, path, id);

    if (type === 'ref') {
      this.instance(node as RefNode, path);
      return;
    }

    this.properties(node, type, path, id, KNOWN_KEYS[type]);
    if (this.options.explicitDefaults) this.defaults(node, type, path);
    if (type === 'text' && node.fill === undefined && scope === 'tree') {
      this.report(
        'warning',
        'text-without-fill',
        path,
        'Text has no "fill" and will be invisible',
        id,
      );
    }
    if (type === 'frame') this.circularSize(node, path);
    this.children(node, path, scope);
  }

  children(node: PenExtra, path: string, scope: 'tree' | 'replacement') {
    if (!Array.isArray(node.children)) return;
    node.children.forEach((child, i) => {
      this.node(child, joinKey(joinKey(path, 'children'), i), scope);
    });
  }

  /** Checks property overrides of a node of type `type` inside an instance. */
  override(value: PenExtra, type: KnownNodeType, path: string, nodeId?: unknown) {
    const result = v.safeParse(OVERRIDE_SCHEMAS[type], value);
    if (!result.success) this.schemaIssues(result.issues, path, nodeId);
    this.properties(value, type, path, nodeId, KNOWN_KEYS[type]);
  }

  instance(node: RefNode, path: string) {
    const id = node.id;
    if (typeof node.ref !== 'string') return; // reported by the schema
    const target = this.index.get(node.ref);
    if (!target) {
      if (!node.ref.includes(':')) {
        this.report(
          'warning',
          'unknown-ref',
          joinKey(path, 'ref'),
          `No node with id "${node.ref}" to instantiate`,
          id,
        );
      }
      return;
    }
    if (target.reusable !== true && target.type !== 'ref') {
      // pen.dev only instantiates reusable nodes; keep it a warning, the file still opens.
      this.report(
        'warning',
        'unknown-ref',
        joinKey(path, 'ref'),
        `Node "${node.ref}" is not marked "reusable": true`,
        id,
      );
    }

    const root = componentRoot(this.index, target);
    const rootType =
      root && isKnownNodeType(root.type) && root.type !== 'ref' ? root.type : undefined;
    if (rootType) {
      const { type: _type, ref: _ref, descendants: _descendants, ...overrides } = node;
      const result = v.safeParse(OVERRIDE_SCHEMAS[rootType], overrides);
      if (!result.success) this.schemaIssues(result.issues, path, id);
      const ownKeys = new Set([...KNOWN_KEYS.ref, ...KNOWN_KEYS[rootType]]);
      this.properties(node, rootType, path, id, ownKeys);
    }

    if (!isObject(node.descendants)) return;
    const descendantsPath = joinKey(path, 'descendants');
    for (const [key, value] of Object.entries(node.descendants)) {
      const valuePath = joinKey(descendantsPath, key);
      if (!isObject(value)) continue; // reported by the schema
      const resolved = resolveInInstance(this.index, node, splitIdPath(key));
      if (!resolved) {
        this.report(
          'warning',
          'unknown-descendant',
          valuePath,
          `"${key}" does not name a node inside the instance of "${node.ref}"`,
          id,
        );
      }
      if (typeof value.type === 'string') {
        this.node(value, valuePath, 'replacement');
        continue;
      }
      if (resolved) {
        const targetRoot = componentRoot(this.index, resolved.node) ?? resolved.node;
        if (isKnownNodeType(targetRoot.type)) {
          const targetType = targetRoot.type;
          const result = v.safeParse(OVERRIDE_SCHEMAS[targetType], value);
          if (!result.success) this.schemaIssues(result.issues, valuePath, id);
          const ownKeys =
            resolved.node.type === 'ref'
              ? new Set([...KNOWN_KEYS.ref, ...KNOWN_KEYS[targetType]])
              : KNOWN_KEYS[targetType];
          this.properties(value, targetType, valuePath, id, ownKeys);
        }
      }
      this.children(value, valuePath, 'replacement');
    }
  }

  defaults(node: PenExtra, type: string, path: string) {
    for (const table of [DEFAULTS['*'], DEFAULTS[type]]) {
      if (!table) continue;
      for (const [key, value] of Object.entries(table)) {
        if (node[key] === value) {
          this.report(
            'info',
            'explicit-default',
            joinKey(path, key),
            `"${key}": ${JSON.stringify(value)} is the default and can be omitted`,
            node.id,
          );
        }
      }
    }
  }

  /** A fit-content frame whose every child fills it has no size to start from. */
  circularSize(node: PenExtra, path: string) {
    if (node.layout === 'none' || !Array.isArray(node.children)) return;
    const children = node.children.filter(
      (child): child is PenExtra =>
        isObject(child) && child.enabled !== false && child.layoutPosition !== 'absolute',
    );
    if (children.length === 0) return;
    for (const axis of ['width', 'height'] as const) {
      const own = node[axis];
      const fits = own === undefined || (typeof own === 'string' && own.startsWith('fit_content'));
      if (!fits) continue;
      const allFill = children.every(
        (child) =>
          typeof child[axis] === 'string' && (child[axis] as string).startsWith('fill_container'),
      );
      if (allFill) {
        this.report(
          'warning',
          'circular-size',
          joinKey(path, axis),
          `${axis} fits its content, but every child fills the frame on this axis; the fallback size is used`,
          node.id,
        );
      }
    }
  }
}

/**
 * Checks a parsed document. Never throws; returns diagnostics with levels:
 * `error` (pen.dev would reject it), `warning` (likely a mistake), `info` (style).
 */
export function validatePen(doc: unknown, options: ValidateOptions = {}): Diagnostic[] {
  if (!isObject(doc)) {
    return [
      {
        level: 'error',
        code: 'schema',
        path: '$',
        message: 'A .pen document must be a JSON object',
      },
    ];
  }
  const validator = new Validator(doc as PenDocument, {
    explicitDefaults: options.explicitDefaults ?? true,
    unknownProperties: options.unknownProperties ?? true,
  });
  validator.run();
  return validator.diagnostics;
}

export interface NodeCheckOptions extends ValidateOptions {
  /** Index of the document (saves a pass over the tree on every call). */
  index?: NodeIndex;
  /** Path of the node in messages. Default `$`. */
  path?: string;
  /** `replacement`: the node replaces a descendant inside an instance. Default `tree`. */
  scope?: 'tree' | 'replacement';
}

const resolveOptions = (options: ValidateOptions): Required<ValidateOptions> => ({
  explicitDefaults: options.explicitDefaults ?? true,
  unknownProperties: options.unknownProperties ?? true,
});

/**
 * Checks one node (with its subtree) against the schema and the rules of `doc`:
 * variables, themes, components. Use it for a node that is about to be inserted.
 */
export function validateNode(
  doc: PenDocument,
  node: unknown,
  options: NodeCheckOptions = {},
): Diagnostic[] {
  const validator = new Validator(doc, resolveOptions(options), options.index);
  validator.node(node, options.path ?? '$', options.scope ?? 'tree');
  return validator.diagnostics;
}

/** Checks property overrides of a descendant of type `type` (the `descendants` value). */
export function validateOverride(
  doc: PenDocument,
  override: Record<string, unknown>,
  type: string,
  options: Omit<NodeCheckOptions, 'scope'> = {},
): Diagnostic[] {
  const validator = new Validator(doc, resolveOptions(options), options.index);
  if (isKnownNodeType(type) && type !== 'ref') {
    validator.override(override as PenExtra, type, options.path ?? '$');
  }
  return validator.diagnostics;
}
