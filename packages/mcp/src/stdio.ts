import { appendFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createExecutor, type Executor } from '@tusche/exec';
import { createServer } from './server.ts';

/** Delay of the write after a change (ADR-009). */
export const SAVE_DELAY_MS = 300;

export interface StdioOptions {
  version?: string;
  cwd?: string;
  /** Defaults to an executor with delayed saves and engine options from the environment. */
  executor?: Executor;
}

const log = (message: string) => process.stderr.write(`[tusche] ${message}\n`);

/**
 * Serves the MCP server on stdin/stdout until the client disconnects; pending changes are
 * written before the process exits. Logs go to stderr only.
 */
export async function serveStdio(options: StdioOptions = {}): Promise<void> {
  const executor =
    options.executor ??
    createExecutor({
      save: { delayMs: SAVE_DELAY_MS },
      engineOptions: { allowNetwork: process.env.TUSCHE_FONTS_OFFLINE !== '1' },
    });
  const callLog = process.env.TUSCHE_CALL_LOG;
  const server = createServer({
    executor,
    ...(callLog
      ? {
          onCall: (entry) =>
            appendFileSync(
              callLog,
              `${JSON.stringify(entry)}
`,
            ),
        }
      : {}),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.version === undefined ? {} : { version: options.version }),
  });

  let closing: Promise<void> | undefined;
  const shutdown = (reason: string) => {
    closing ??= (async () => {
      for (const { filePath, error } of await executor.flushAll()) {
        log(`not saved: ${filePath}: ${error.message}`);
      }
      log(`stopped (${reason})`);
      process.exit(0);
    })();
    return closing;
  };

  const transport = new StdioServerTransport();
  transport.onclose = () => void shutdown('client closed');
  process.stdin.on('end', () => void shutdown('stdin closed'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  await server.connect(transport);
  log(`MCP server ready on stdio (cwd ${options.cwd ?? process.cwd()})`);
}
