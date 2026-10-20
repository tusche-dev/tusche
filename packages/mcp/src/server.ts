import { isAbsolute, resolve } from 'node:path';
import { type CallToolResult, McpServer } from '@modelcontextprotocol/server';
import {
  type DocumentSession,
  type ExecRequest,
  type Executor,
  type ExecWarning,
  formatLint,
  formatResult,
  type HistoryResult,
  type LintIssue,
  lintDocument,
} from '@tusche/exec';
import { CURRENT_VERSION } from '@tusche/pen-format';
import { readSkill } from '@tusche/skill';
import { getStyle, listStyles } from '@tusche/styles';
import { toStandardJsonSchema } from '@valibot/to-json-schema';
import * as v from 'valibot';
import { displayPath, documentSummary, sessionLine } from './summary.ts';

export interface ServerOptions {
  executor: Executor;
  /** Folder relative file paths are resolved against. Default `process.cwd()`. */
  cwd?: string;
  /** Version reported to clients and in `get_app_state`. */
  version?: string;
}

/** Images per `render` call, as for `TakeScreenshot`. */
const MAX_RENDERS = 6;
/** Lint findings listed in full; the rest are counted. */
const MAX_LINT = 100;

/** An error the agent can act on: the message and what to do. */
class ToolError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}

const text = (body: string): CallToolResult => ({ content: [{ type: 'text', text: body }] });

const failure = (error: unknown): CallToolResult => {
  const message = error instanceof Error ? error.message : String(error);
  const hint = error instanceof ToolError && error.hint ? `\nhint: ${error.hint}` : '';
  return { content: [{ type: 'text', text: `error: ${message}${hint}` }], isError: true };
};

const png = (data: Uint8Array) => ({
  type: 'image' as const,
  data: Buffer.from(data).toString('base64'),
  mimeType: 'image/png',
});

const filePath = v.optional(
  v.pipe(
    v.string(),
    v.minLength(1),
    v.description(
      'Path of the .pen file; relative to the working folder. Default: the active document.',
    ),
  ),
);
const steps = v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50)));

const warningLines = (warnings: readonly ExecWarning[]) =>
  warnings.map((w) => `  [${w.code}] ${w.message}`);

/** Lint report with at most MAX_LINT findings listed; the summary counts all of them. */
function lintReport(issues: readonly LintIssue[]): string {
  const report = formatLint(issues.slice(0, MAX_LINT)).split('\n');
  report[0] = formatLint(issues).split('\n')[0] as string;
  if (issues.length > MAX_LINT) report.push(`  … ${issues.length - MAX_LINT} more`);
  return report.join('\n');
}

/** Creates the Tusche MCP server over an executor (tools from 06-agent-api §1). */
export function createServer(options: ServerOptions): McpServer {
  const { executor } = options;
  const cwd = options.cwd ?? process.cwd();
  const version = options.version ?? '0.0.0';
  let active: string | undefined;

  const absolute = (path: string) => (isAbsolute(path) ? resolve(path) : resolve(cwd, path));
  const shown = (session: DocumentSession) => displayPath(session.filePath, cwd);

  const server = new McpServer({ name: 'tusche', version });

  /**
   * Registers a tool. Arguments are checked by the Valibot schema; errors thrown by the
   * body become `isError` answers, and `notes` (a reload, …) go before the answer.
   */
  const tool = <T extends v.ObjectEntries>(
    name: string,
    description: string,
    entries: T,
    body: (
      args: v.InferOutput<v.ObjectSchema<T, undefined>>,
      notes: string[],
    ) => Promise<CallToolResult>,
  ) => {
    server.registerTool(
      name,
      { description, inputSchema: toStandardJsonSchema(v.object(entries)) },
      async (args) => {
        const notes: string[] = [];
        let result: CallToolResult;
        try {
          result = await body(args, notes);
        } catch (error) {
          result = failure(error);
        }
        if (notes.length === 0) return result;
        const [first, ...rest] = result.content;
        const head = notes.join('\n');
        return first?.type === 'text'
          ? { ...result, content: [{ type: 'text', text: `${head}\n${first.text}` }, ...rest] }
          : { ...result, content: [{ type: 'text', text: head }, ...result.content] };
      },
    );
  };

  /** The session a tool works on, with the file checked against the disk (ADR-009). */
  async function sessionFor(path: string | undefined, notes: string[]): Promise<DocumentSession> {
    let session: DocumentSession;
    if (path !== undefined) {
      try {
        session = await executor.open(absolute(path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new ToolError(
            `no file at ${path}`,
            'call open_document with create: true to start a new document',
          );
        }
        throw error;
      }
    } else {
      const current = active === undefined ? undefined : executor.session(active);
      if (!current) {
        throw new ToolError(
          'no document is open',
          'call open_document with the filePath of a .pen file (create: true for a new one)',
        );
      }
      session = current;
    }
    active = session.filePath;
    const state = await session.checkDisk();
    if (state === 'deleted') {
      await executor.close(session.filePath);
      active = undefined;
      throw new ToolError(
        `${shown(session)} was deleted on disk`,
        'open_document with create: true starts it again',
      );
    }
    if (state === 'reloaded') {
      notes.push(
        `[reloaded] ${shown(session)} changed on disk and was read again; undo history cleared`,
      );
    }
    return session;
  }

  const conflictError = (session: DocumentSession) =>
    new ToolError(
      `${shown(session)} changed on disk while this session has unsaved changes`,
      'open_document with reload: true takes the file from disk (drops unsaved changes); save_document writes this session over it',
    );

  const history = (kind: string, session: DocumentSession, result: HistoryResult) => {
    const lines = [
      result.steps === 0
        ? `nothing to ${kind}`
        : `${kind} · ${result.steps} step${result.steps === 1 ? '' : 's'} · ${shown(session)}`,
      `  undo ${result.undo} · redo ${result.redo}`,
    ];
    if (result.warnings.length > 0) lines.push('warnings:', ...warningLines(result.warnings));
    return text(lines.join('\n'));
  };

  tool(
    'get_app_state',
    'Tusche state: the active .pen document, every open document (unsaved changes, conflicts with the file on disk, undo depth) and where to start. Call it first.',
    {},
    async () => {
      const sessions = executor.sessions();
      const lines = [`Tusche ${version} · .pen format ${CURRENT_VERSION}`];
      if (sessions.length === 0) {
        lines.push('no document open');
      } else {
        lines.push('open documents (* active):');
        for (const session of sessions) {
          lines.push(sessionLine(session, cwd, session.filePath === active));
        }
      }
      lines.push(
        'start: read_skill (once per conversation), then open_document (create: true for a new file), get_style for a direction, and execute.',
      );
      return text(lines.join('\n'));
    },
  );

  tool(
    'read_skill',
    'The Tusche design skill. Without a path: SKILL.md — read it before the first edit. With a path: a file SKILL.md links to (execute.md, pen-format.md).',
    { path: v.optional(v.pipe(v.string(), v.description('File of the skill, e.g. "execute.md"'))) },
    async ({ path }) => text(await readSkill(path)),
  );

  tool(
    'get_style',
    'Style archetypes: a ready visual direction (fonts, palette, scales, rules, a SetVariables payload). Without a name: the list. With a name: the style with parameters applied (defaults for the rest).',
    {
      name: v.optional(v.string()),
      params: v.optional(
        v.pipe(v.record(v.string(), v.string()), v.description('e.g. {"accent": "olive"}')),
      ),
    },
    async ({ name, params }) => {
      if (name === undefined) {
        const lines = ['styles:'];
        for (const style of await listStyles()) {
          lines.push(`  ${style.name} — ${style.title}: ${style.summary}`);
          for (const [param, values] of Object.entries(style.params)) {
            lines.push(`    ${param}: ${values.join(' | ')}`);
          }
        }
        lines.push('get_style with a name returns the style; pass its variables to SetVariables.');
        return text(lines.join('\n'));
      }
      return text(JSON.stringify(await getStyle(name, params), null, 2));
    },
  );

  tool(
    'open_document',
    'Opens a .pen file (or creates an empty one with create: true) and makes it the active document. Returns its top-level nodes, components and variables. reload: true drops unsaved changes and reads the file again.',
    {
      filePath: v.pipe(v.string(), v.minLength(1)),
      create: v.optional(v.boolean()),
      reload: v.optional(v.boolean()),
    },
    async ({ filePath: path, create, reload }, notes) => {
      const file = absolute(path);
      if (!file.endsWith('.pen')) throw new ToolError(`${path} is not a .pen file`);
      const open = async () => {
        try {
          return await executor.open(file, { create: create === true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new ToolError(`no file at ${path}`, 'pass create: true to start a new document');
          }
          throw error;
        }
      };
      let session = await open();
      if (reload === true) {
        await session.reload();
      } else {
        const state = await session.checkDisk();
        if (state === 'reloaded') {
          notes.push('[reloaded] the file changed on disk and was read again');
        } else if (state === 'deleted') {
          await executor.close(file);
          session = await open();
        }
      }
      active = session.filePath;
      const lines = [
        `opened ${shown(session)} · version ${session.doc.version}`,
        ...documentSummary(session.doc),
      ];
      if (session.conflict) {
        const e = conflictError(session);
        lines.push(`CONFLICT: ${e.message}`, `hint: ${e.hint}`);
      }
      return text(lines.join('\n'));
    },
  );

  tool(
    'save_document',
    'Writes pending changes now. Changes are saved automatically shortly after each execute; use this to resolve a conflict by writing this session over the file on disk.',
    { filePath },
    async ({ filePath: path }, notes) => {
      const session = await sessionFor(path, notes);
      const pending = session.dirty;
      await session.flush({ force: true });
      return text(pending ? `saved ${shown(session)}` : `nothing to save · ${shown(session)}`);
    },
  );

  tool(
    'execute',
    'Runs a JavaScript snippet against the document as one transaction (Insert, Update, Get, TakeScreenshot, …; see read_skill "execute.md"). After a failure, send editId + edits instead of the whole snippet.',
    {
      filePath,
      input: v.optional(v.pipe(v.string(), v.description('The snippet'))),
      editId: v.optional(v.pipe(v.string(), v.description('editId of a failed call to fix'))),
      edits: v.optional(
        v.pipe(
          v.array(
            v.object({ find: v.string(), replace: v.string(), all: v.optional(v.boolean()) }),
          ),
          v.description('Replacements applied in order to the failed snippet'),
        ),
      ),
    },
    async (args, notes) => {
      const hasEdit = args.editId !== undefined || args.edits !== undefined;
      if ((args.input !== undefined) === hasEdit) {
        throw new ToolError(
          'pass either input, or editId with edits',
          'input is a new snippet; editId + edits fix the failed one',
        );
      }
      let request: ExecRequest;
      if (args.input !== undefined) request = { input: args.input };
      else if (args.editId !== undefined && args.edits !== undefined)
        request = { editId: args.editId, edits: args.edits };
      else throw new ToolError('editId and edits go together');

      const session = await sessionFor(args.filePath, notes);
      if (session.conflict) throw conflictError(session);
      const result = await session.execute(request);
      const formatted = formatResult(result);
      const body = session.saveError
        ? `${formatted.text}\nwarnings:\n  [save-failed] ${session.saveError}`
        : formatted.text;
      return {
        content: [{ type: 'text', text: body }, ...formatted.images.map((shot) => png(shot.png))],
        isError: !result.ok,
      };
    },
  );

  tool(
    'render',
    `PNG images of nodes (by id or instance path), without running a snippet. At most ${MAX_RENDERS} per call; the long side is at most 1600 px.`,
    {
      filePath,
      nodeIds: v.pipe(
        v.array(v.pipe(v.string(), v.minLength(1))),
        v.minLength(1),
        v.maxLength(MAX_RENDERS),
      ),
      scale: v.optional(v.pipe(v.number(), v.minValue(0.1), v.maxValue(4))),
    },
    async ({ filePath: path, nodeIds, scale }, notes) => {
      const session = await sessionFor(path, notes);
      const images: Uint8Array[] = [];
      const lines: string[] = [];
      for (const id of nodeIds) {
        if (session.scene.projection.rootOf(id) === undefined) {
          throw new ToolError(`no node "${id}"`, 'ids come from execute names or Get');
        }
        const data = await session.scene.render([id], { scale: scale ?? 1, maxSide: 1600 });
        if (data) {
          images.push(data);
          lines.push(`  ${id}`);
        } else {
          lines.push(`  ${id}: nothing to show (unknown path or empty)`);
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: [`rendered ${images.length} of ${nodeIds.length}:`, ...lines].join('\n'),
          },
          ...images.map(png),
        ],
      };
    },
  );

  tool(
    'lint',
    'Checks the whole document or one subtree: schema errors, clipped or invisible content, unknown fonts, colour contrast, tiny text and other design rules. info: true adds style suggestions.',
    { filePath, nodeId: v.optional(v.string()), info: v.optional(v.boolean()) },
    async ({ filePath: path, nodeId, info }, notes) => {
      const session = await sessionFor(path, notes);
      let issues: LintIssue[];
      try {
        issues = await lintDocument(session, {
          ...(nodeId === undefined ? {} : { path: nodeId }),
          info: info === true,
        });
      } catch (error) {
        throw new ToolError((error as Error).message, 'ids come from execute names or Get');
      }
      return text(lintReport(issues));
    },
  );

  tool(
    'undo',
    'Undoes the last committed execute calls that changed the document (globals included). Default 1 step.',
    { filePath, steps },
    async ({ filePath: path, steps: n }, notes) => {
      const session = await sessionFor(path, notes);
      if (session.conflict) throw conflictError(session);
      return history('undo', session, await session.undo(n ?? 1));
    },
  );

  tool(
    'redo',
    'Redoes undone changes. Default 1 step. A new execute clears what can be redone.',
    { filePath, steps },
    async ({ filePath: path, steps: n }, notes) => {
      const session = await sessionFor(path, notes);
      if (session.conflict) throw conflictError(session);
      return history('redo', session, await session.redo(n ?? 1));
    },
  );

  return server;
}
