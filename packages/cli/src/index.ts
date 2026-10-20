#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { serveStdio } from '@tusche/mcp';
import { COMMANDS, type Flags, type Io, UsageError } from './commands.ts';

export { COMMANDS, type Flags, type Io, UsageError } from './commands.ts';

const VERSION = (
  JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
    version: string;
  }
).version;

const USAGE = `tusche ${VERSION} — an open design canvas for AI agents

usage: tusche <command> [options]

  mcp                                     MCP server on stdio (what your agent runs)
  exec <file.pen> <script.js | ->         run an execute snippet; --out <dir> for screenshots,
                                          --create to start a new file
  render <file.pen>                       PNG of top-level nodes or --node <id>…;
                                          --scale <n>, --max-side <px>, --out <dir>
  export <file.pen> --format <f> --out <path>
                                          png | jpeg | webp | svg | html-tailwind; --node <id>…,
                                          --scale <n>
  lint <file.pen>                         design and layout problems; --node <id>, --info,
                                          --format text|json; exit 1 on errors
  validate <file.pen>                     check against the .pen schema; --info; exit 1 on errors
  migrate <file.pen>                      upgrade to the current format version; --dry-run

environment: TUSCHE_FONTS_OFFLINE=1, TUSCHE_ALLOW_REMOTE_ASSETS=1, TUSCHE_ROOT=<dir>`;

const OPTIONS = {
  node: { type: 'string', multiple: true },
  out: { type: 'string' },
  scale: { type: 'string' },
  'max-side': { type: 'string' },
  format: { type: 'string' },
  info: { type: 'boolean' },
  create: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

/** Runs the CLI; returns the exit code (0 ok, 1 findings or a failed snippet, 2 usage). */
export async function main(argv: string[], io: Io): Promise<number> {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (error) {
    io.err(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const [command, ...args] = positionals;
  if (values.version) {
    io.out(VERSION);
    return 0;
  }
  if (values.help || command === undefined || command === 'help') {
    io.out(USAGE);
    return command === undefined && !values.help ? 2 : 0;
  }
  if (command === 'mcp') {
    await serveStdio({ version: VERSION, cwd: io.cwd });
    return -1;
  }
  const run = COMMANDS[command as keyof typeof COMMANDS];
  if (!run) {
    io.err(`unknown command "${command}"\n\n${USAGE}`);
    return 2;
  }
  try {
    return await run(io, args, values as Flags);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`${error.message}\nsee: tusche --help`);
      return 2;
    }
    io.err(`error: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) {
  // `tusche lint … | head`: a closed pipe is not an error.
  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(0);
    throw error;
  });
  const code = await main(process.argv.slice(2), {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    cwd: process.cwd(),
    stdin: () => new Response(Bun.stdin.stream()).text(),
  });
  // `mcp` keeps running until the client disconnects.
  if (code >= 0) process.exit(code);
}
