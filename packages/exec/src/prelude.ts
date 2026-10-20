/**
 * JavaScript that runs in the VM before every snippet: the API functions agents call.
 * They pass JSON to the host through `__host(op, json)` and get JSON back; host objects
 * never enter the VM (ADR-003). `Get` with a visitor walks a tree that is pulled from the
 * host lazily, one batch of children at a time (ADR-008).
 */
export const PRELUDE = `
(() => {
  'use strict';
  const host = globalThis.__host;
  delete globalThis.__host;

  const ERRORS = { TypeError, RangeError, ReferenceError, SyntaxError };

  const call = (op, args) => {
    const json = JSON.stringify(args, (key, value) => {
      const type = typeof value;
      if (type === 'function' || type === 'symbol' || type === 'bigint') {
        throw new TypeError(op + '(): ' + (key ? '"' + key + '"' : 'an argument') + ' is a ' + type + '; only JSON values can be passed');
      }
      if (type === 'number' && !Number.isFinite(value)) {
        throw new TypeError(op + '(): ' + (key ? '"' + key + '"' : 'an argument') + ' is ' + value + '; numbers must be finite');
      }
      return value;
    });
    const response = JSON.parse(host(op, json));
    if (response.error) {
      const Type = ERRORS[response.error.name] || Error;
      const error = new Type(response.error.message);
      if (!ERRORS[response.error.name]) error.name = response.error.name;
      if (response.error.hint) error.hint = response.error.hint;
      throw error;
    }
    return response.value;
  };

  const show = (value) => {
    if (typeof value === 'string') return value;
    if (value === undefined) return 'undefined';
    if (typeof value === 'function') return '[function ' + (value.name || 'anonymous') + ']';
    if (value instanceof Error) return value.name + ': ' + value.message;
    try {
      const json = JSON.stringify(value);
      return json === undefined ? String(value) : json;
    } catch (error) {
      return String(value);
    }
  };

  const node = (entry, options) => {
    const value = entry.node;
    let children;
    Object.defineProperty(value, 'children', {
      enumerable: false,
      get() {
        if (children === undefined) {
          children = entry.children ? call('GetNodes', [entry.children, options]).map((e) => node(e, options)) : [];
        }
        return children;
      },
    });
    return { entry, value };
  };

  function Get(a, b, c) {
    let path = null;
    let visit;
    let options;
    if (typeof a === 'function') {
      visit = a;
      options = b;
    } else {
      path = a;
      if (typeof b === 'function') {
        visit = b;
        options = c;
      } else {
        options = b;
      }
    }
    if (path !== null && typeof path !== 'string') {
      throw new TypeError('Get(): the first argument must be a node id or path, or a visitor function');
    }
    options = options === undefined ? null : options;
    if (!visit) {
      if (path === null) throw new TypeError('Get(): give a path, a visitor or both; the whole document is never returned at once');
      return call('Get', [path, options]);
    }
    const limit = options && typeof options.depth === 'number' ? options.depth : Infinity;
    const results = [];
    const walk = (item, parentCtx, depth, index) => {
      let skip = false;
      const path = item.entry.path;
      let bounds;
      let problems;
      let measured = false;
      let checked = false;
      const ctx = {
        node: item.value,
        parentCtx,
        depth,
        index,
        get bounds() {
          if (!measured) {
            bounds = call('Bounds', [path]) || undefined;
            measured = true;
          }
          return bounds;
        },
        get problems() {
          if (!checked) {
            problems = call('Problems', [path]) || undefined;
            checked = true;
          }
          return problems;
        },
        skipChildren() {
          skip = true;
        },
      };
      const result = visit(item.value, ctx);
      if (result !== undefined) results.push(result);
      if (skip || depth >= limit || !item.entry.children) return;
      item.value.children.forEach((child, i) => walk(child, ctx, depth + 1, i));
    };
    const roots = path === null ? call('GetRoots', [options]) : call('GetNodes', [[path], options]);
    roots.forEach((entry, i) => walk(node(entry, options), undefined, 0, i));
    return results;
  }

  const api = {
    Insert: (parent, node) => call('Insert', [parent, node]),
    Copy: (path, parent, overrides) => call('Copy', [path, parent, overrides]),
    Update: (path, props) => {
      call('Update', [path, props]);
    },
    Replace: (path, node) => call('Replace', [path, node]),
    Move: (path, parent, index) => {
      call('Move', [path, parent, index]);
    },
    Delete: (path) => {
      call('Delete', [path]);
    },
    SetVariables: (variables, replace) => {
      call('SetVariables', [variables, replace]);
    },
    GetVariables: () => call('GetVariables', []),
    Get,
    FindEmptySpace: (query) => call('FindEmptySpace', [query]),
    Print: (...values) => {
      call('Print', [values.map(show)]);
    },
    TakeScreenshot: (nodeIds, options) => {
      call('TakeScreenshot', [nodeIds, options]);
    },
    Export: (nodeIds, format, outPath, options) => call('Export', [nodeIds, format, outPath, options]),
    Generate: (...args) => call('Generate', [args.length]),
  };
  const fixed = (name, value) =>
    Object.defineProperty(globalThis, name, { value, writable: false, enumerable: false, configurable: false });
  for (const name of Object.keys(api)) fixed(name, api[name]);
  fixed('document', 'document');

  const builtins = new Set(Object.getOwnPropertyNames(globalThis));
  builtins.add('__tuscheRestore');
  builtins.add('__tuscheCollect');

  fixed('__tuscheRestore', (json) => {
    const saved = JSON.parse(json);
    for (const name of Object.keys(saved)) globalThis[name] = JSON.parse(saved[name]);
  });
  // Own properties the snippets assigned, as JSON; anything that is not JSON is dropped.
  fixed('__tuscheCollect', () => {
    const saved = {};
    const dropped = [];
    for (const name of Object.getOwnPropertyNames(globalThis)) {
      if (builtins.has(name)) continue;
      try {
        const json = JSON.stringify(globalThis[name]);
        if (json === undefined) dropped.push(name);
        else saved[name] = json;
      } catch (error) {
        dropped.push(name);
      }
    }
    return JSON.stringify({ saved, dropped });
  });
})();
`;

/** The snippet runs as a function body: `var` and `const` stay local, plain assignments are globals. */
export const wrapSnippet = (code: string): string => `(function () {${code}\n}).call(globalThis);`;

/** File name of the snippet in VM stack traces. */
export const SNIPPET_FILE = 'snippet.js';
