// Installs the packages from .release/packages the way a user gets them from npm and checks
// that they run under Node and Bun: CLI, a render equal to one from the sources, the MCP server
// and the preview page. Run `bun scripts/release/build.ts` first.
//
//   bun scripts/release/smoke.ts [--keep]
//
// The forks and @tusche/* are not in the registry before the release, so the test project
// points every one of them at its local tarball through npm `overrides`.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const ROOT = resolve(import.meta.dir, '../..');
const PACKAGES = join(ROOT, '.release', 'packages');
const FIXTURE = join(ROOT, 'fixtures', 'pen', 'eval', 'design.pen');
const keep = process.argv.includes('--keep');

if (!existsSync(join(PACKAGES, 'publish-order.txt'))) {
  throw new Error('no .release/packages: run bun scripts/release/build.ts first');
}

const work = mkdtempSync(join(tmpdir(), 'tusche-smoke-'));
const env: Record<string, string> = {
  ...(process.env as Record<string, string>),
  TUSCHE_FONTS_OFFLINE: '1',
  TUSCHE_CACHE_DIR: join(work, 'cache'),
};

function run(cmd: string[], cwd = work): string {
  const proc = Bun.spawnSync(cmd, { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  const output = proc.stdout.toString() + proc.stderr.toString();
  if (proc.exitCode !== 0) throw new Error(`${cmd.join(' ')} exited ${proc.exitCode}:\n${output}`);
  return output;
}

let failures = 0;
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  const started = performance.now();
  try {
    await body();
    console.log(`ok   ${name} (${Math.round(performance.now() - started)} ms)`);
  } catch (error) {
    failures++;
    console.log(`FAIL ${name}\n     ${(error as Error).message.replaceAll('\n', '\n     ')}`);
  }
}

// 1. Tarballs and a project that installs them.
const tarballs = join(work, 'tarballs');
mkdirSync(tarballs);
const order = readFileSync(join(PACKAGES, 'publish-order.txt'), 'utf8').trim().split('\n');
const tarballOf = new Map<string, string>();
for (const dir of order) {
  const name = (
    JSON.parse(readFileSync(join(PACKAGES, dir, 'package.json'), 'utf8')) as { name: string }
  ).name;
  const before = new Set(readdirSync(tarballs));
  run(['npm', 'pack', join(PACKAGES, dir), '--pack-destination', tarballs, '--silent']);
  const file = readdirSync(tarballs).find((f) => !before.has(f));
  if (!file) throw new Error(`npm pack ${dir} gave no tarball`);
  tarballOf.set(name, `file:${join(tarballs, file).replaceAll('\\', '/')}`);
}
// The aliases in the published manifests name the upstream packages.
const overrides: Record<string, string> = {};
for (const [name, spec] of tarballOf) {
  overrides[name] = spec;
  const upstream = name.match(/^@tusche\/open-pencil-(.+)$/)?.[1];
  if (upstream) overrides[`@open-pencil/${upstream}`] = spec;
}
const project = join(work, 'project');
mkdirSync(project);
writeFileSync(
  join(project, 'package.json'),
  JSON.stringify(
    { private: true, dependencies: { '@tusche/cli': tarballOf.get('@tusche/cli') }, overrides },
    null,
    2,
  ),
);
await check('npm install', () => {
  run(['npm', 'install', '--no-audit', '--no-fund', '--loglevel=error'], project);
});

const BIN = join(project, 'node_modules', '@tusche', 'cli', 'dist', 'bin.js');
const runtimes = [
  { name: 'node', cmd: ['node', BIN] },
  { name: 'bun', cmd: ['bun', BIN] },
];
const expected = JSON.parse(readFileSync(join(ROOT, 'packages', 'cli', 'package.json'), 'utf8'))
  .version as string;

// 2. A render from the sources to compare with.
const reference = join(work, 'render-src');
await check('render from sources (reference)', () => {
  run([
    'bun',
    join(ROOT, 'packages', 'cli', 'src', 'index.ts'),
    'render',
    FIXTURE,
    '--out',
    reference,
  ]);
});

for (const runtime of runtimes) {
  const tusche = (...args: string[]) => run([...runtime.cmd, ...args], project);

  await check(`${runtime.name}: --version`, () => {
    const out = tusche('--version').trim();
    if (out !== expected) throw new Error(`expected ${expected}, got ${out}`);
  });

  await check(`${runtime.name}: validate`, () => {
    tusche('validate', FIXTURE);
  });

  await check(`${runtime.name}: render equals the one from sources`, () => {
    const out = join(work, `render-${runtime.name}`);
    tusche('render', FIXTURE, '--out', out);
    const want = readdirSync(reference).sort();
    const got = readdirSync(out).sort();
    if (want.join() !== got.join())
      throw new Error(`files differ: ${got.join()} vs ${want.join()}`);
    const differ = want.filter(
      (f) => !readFileSync(join(out, f)).equals(readFileSync(join(reference, f))),
    );
    if (differ.length > 0) throw new Error(`pixels differ: ${differ.join(', ')}`);
  });

  await check(`${runtime.name}: mcp lists tools and reads the skill`, async () => {
    const [command, ...args] = runtime.cmd as [string, ...string[]];
    const transport = new StdioClientTransport({
      command,
      args: [...args, 'mcp'],
      cwd: project,
      env: { ...getDefaultEnvironment(), ...env },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'smoke', version: '1.0' });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      for (const name of ['execute', 'render', 'read_skill']) {
        if (!tools.some((t) => t.name === name)) throw new Error(`no tool ${name}`);
      }
      const skill = await client.callTool({ name: 'read_skill', arguments: {} });
      if (skill.isError) throw new Error(`read_skill failed: ${JSON.stringify(skill.content)}`);
    } finally {
      await client.close();
    }
  });

  await check(`${runtime.name}: preview serves the page, wasm and the document`, async () => {
    const proc = Bun.spawn([...runtime.cmd, 'preview', FIXTURE, '--port', '0'], {
      cwd: project,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    try {
      const url = await firstUrl(proc.stdout);
      for (const path of ['', 'client.js', 'canvaskit.wasm']) {
        const res = await fetch(`${url}${path}`);
        if (!res.ok) throw new Error(`GET /${path}: ${res.status}`);
        await res.arrayBuffer();
      }
      const message = await new Promise<string>((done, fail) => {
        const socket = new WebSocket(`${url.replace('http', 'ws')}ws`);
        const timer = setTimeout(() => fail(new Error('no message within 30 s')), 30_000);
        socket.onmessage = (event) => {
          clearTimeout(timer);
          socket.close();
          done(String(event.data));
        };
        socket.onerror = () => fail(new Error('WebSocket error'));
      });
      if (!message.includes('"update"')) throw new Error(`unexpected: ${message.slice(0, 200)}`);
    } finally {
      proc.kill();
      await proc.exited;
    }
  });
}

/** The address `tusche preview` prints. */
async function firstUrl(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + 60_000;
  for await (const chunk of stream) {
    text += decoder.decode(chunk);
    const match = text.match(/https?:\/\/[^\s]+\//);
    if (match) return match[0];
    if (Date.now() > deadline) break;
  }
  throw new Error(`preview printed no address:\n${text}`);
}

if (keep) console.log(`kept ${work}`);
else rmSync(work, { recursive: true, force: true });
console.log(failures === 0 ? 'smoke: all passed' : `smoke: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
