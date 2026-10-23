// Builds the packages as they go to npm (ADR-012) into .release/packages/<dir>:
// compiled dist, rewritten package.json, data folders, README, LICENSE and NOTICE. Also
// republishes the patched OpenPencil packages as @tusche/open-pencil-* forks.
//
//   bun scripts/release/build.ts
//
// The repository keeps running from src; publish only from .release/packages.
import {
  cpSync,
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

const ROOT = resolve(import.meta.dir, '../..');
const RELEASE = join(ROOT, '.release');
const BUILD = join(RELEASE, 'build');
const OUT = join(RELEASE, 'packages');

type Json = Record<string, unknown>;
type Deps = Record<string, string>;

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Json;
const writeJson = (path: string, data: unknown) =>
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);

function run(cmd: string[], cwd = ROOT): string {
  const proc = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (proc.exitCode !== 0) {
    throw new Error(`${cmd.join(' ')} failed:\n${proc.stdout.toString()}${proc.stderr.toString()}`);
  }
  return proc.stdout.toString() + proc.stderr.toString();
}

/** Upstream packages we patch: name → version and patch file, from the root package.json. */
function patchedPackages(): { name: string; version: string; patch: string }[] {
  const patched = readJson(join(ROOT, 'package.json')).patchedDependencies as Deps;
  return Object.entries(patched).map(([spec, patch]) => {
    const at = spec.lastIndexOf('@');
    return { name: spec.slice(0, at), version: spec.slice(at + 1), patch: join(ROOT, patch) };
  });
}

/** `@open-pencil/core` → `@tusche/open-pencil-core`. */
const forkName = (name: string) => `@tusche/${name.replace(/^@/, '').replace('/', '-')}`;
/** Fork versions: upstream version plus our revision; bump the revision when patches change. */
const FORK_REVISION = 1;
const forkVersion = (version: string) => `${version}-tusche.${FORK_REVISION}`;

const packageDirs = readdirSync(join(ROOT, 'packages')).filter((dir) =>
  existsSync(join(ROOT, 'packages', dir, 'package.json')),
);
const manifests = new Map(
  packageDirs.map((dir) => [dir, readJson(join(ROOT, 'packages', dir, 'package.json'))]),
);
const versions = new Set([...manifests.values()].map((m) => m.version as string));
if (versions.size !== 1) throw new Error(`packages differ in version: ${[...versions].join(', ')}`);
const VERSION = [...versions][0] as string;

const forks = patchedPackages();
/** npm aliases that replace the patched upstream packages in published dependencies. */
const aliases: Deps = Object.fromEntries(
  forks.map((f) => [f.name, `npm:${forkName(f.name)}@${forkVersion(f.version)}`]),
);

function withAliases(deps: Deps | undefined): Deps | undefined {
  if (!deps) return deps;
  return Object.fromEntries(
    Object.entries(deps).map(([name, range]) => {
      if (range.startsWith('workspace:')) return [name, VERSION];
      return [name, aliases[name] ?? range];
    }),
  );
}

/** `./src/x.ts` → `{ types: ./dist/x.d.ts, default: ./dist/x.js }`. */
function distExport(path: string) {
  const base = path.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '');
  return { types: `${base}.d.ts`, default: `${base}.js` };
}

function buildPackage(dir: string): void {
  const source = join(ROOT, 'packages', dir);
  const target = join(OUT, dir);
  const pkg = manifests.get(dir) as Json;
  mkdirSync(target, { recursive: true });
  cpSync(join(BUILD, dir, 'src'), join(target, 'dist'), { recursive: true });

  const extra = ((pkg.files as string[]) ?? []).filter((f) => f !== 'src');
  for (const folder of extra)
    cpSync(join(source, folder), join(target, folder), { recursive: true });
  // npm shows the README outside the repository: relative links point at GitHub.
  const base = `https://github.com/tusche-dev/tusche/blob/main/packages/${dir}/`;
  const readme = readFileSync(join(source, 'README.md'), 'utf8').replace(
    /\]\((?!https?:|#|mailto:)([^)]+)\)/g,
    (_, link: string) => `](${new URL(link, base).href})`,
  );
  writeFileSync(join(target, 'README.md'), readme);
  for (const file of ['LICENSE', 'NOTICE']) cpSync(join(ROOT, file), join(target, file));

  const exports = Object.fromEntries(
    Object.entries(pkg.exports as Deps).map(([key, path]) => [key, distExport(path)]),
  );
  const out: Json = {
    name: pkg.name,
    version: VERSION,
    description: pkg.description,
    license: pkg.license,
    type: pkg.type,
    ...(pkg.bin ? { bin: { tusche: './dist/bin.js' } } : {}),
    exports,
    files: ['dist', ...extra],
    engines: { node: '>=22' },
    repository: pkg.repository,
    homepage: 'https://github.com/tusche-dev/tusche#readme',
    bugs: 'https://github.com/tusche-dev/tusche/issues',
    keywords: ['tusche', 'pen', 'design', 'mcp', 'ai-agents'],
    dependencies: withAliases(pkg.dependencies as Deps | undefined),
    publishConfig: { access: 'public' },
  };
  writeJson(join(target, 'package.json'), out);
}

/** The preview page, built for the browser ahead of time (the server falls back to Bun.build). */
async function buildPreviewClient(): Promise<void> {
  const client = join(OUT, 'preview', 'dist', 'client');
  rmSync(client, { recursive: true, force: true });
  mkdirSync(client, { recursive: true });
  const src = join(ROOT, 'packages', 'preview', 'src', 'client');
  const result = await Bun.build({
    entrypoints: [join(src, 'main.ts')],
    target: 'browser',
    minify: true,
  });
  const output = result.outputs[0];
  if (!result.success || !output) {
    throw new Error(`preview page build failed: ${result.logs.map(String).join('\n')}`);
  }
  writeFileSync(join(client, 'client.js'), await output.text());
  cpSync(join(src, 'index.html'), join(client, 'index.html'));
}

/** Upstream tarball with our patch applied, renamed to @tusche/open-pencil-*. */
function buildFork(fork: { name: string; version: string; patch: string }): void {
  // Outside the repository: inside one, `git apply` silently skips paths it does not own.
  const work = mkdtempSync(join(tmpdir(), 'tusche-fork-'));
  run(['npm', 'pack', `${fork.name}@${fork.version}`, '--silent'], work);
  const tarball = readdirSync(work).find((f) => f.endsWith('.tgz'));
  if (!tarball) throw new Error(`npm pack ${fork.name}@${fork.version} gave no tarball`);
  run(['tar', '-xzf', tarball], work);
  const unpacked = join(work, 'package');
  const applied = run(['git', 'apply', '--verbose', '--whitespace=nowarn', fork.patch], unpacked);
  if (!applied.includes('Applied patch')) throw new Error(`${fork.patch} applied nothing`);

  const pkg = readJson(join(unpacked, 'package.json'));
  pkg.name = forkName(fork.name);
  pkg.version = forkVersion(fork.version);
  pkg.dependencies = withAliases(pkg.dependencies as Deps | undefined);
  pkg.description = `${fork.name}@${fork.version} with Tusche's patches (until they ship upstream).`;
  pkg.repository = { type: 'git', url: 'git+https://github.com/tusche-dev/tusche.git' };
  pkg.publishConfig = { access: 'public' };
  delete pkg.scripts;
  delete pkg.devDependencies;
  writeJson(join(unpacked, 'package.json'), pkg);

  const readme = join(unpacked, 'README.md');
  const upstream = existsSync(readme) ? readFileSync(readme, 'utf8') : '';
  writeFileSync(
    readme,
    `> **This is ${fork.name}@${fork.version} from [OpenPencil](https://github.com/open-pencil/open-pencil) (MIT) with patches from [Tusche](https://github.com/tusche-dev/tusche/tree/main/patches)** that are not released upstream yet. Use the original package unless you need exactly these fixes.\n\n${upstream}`,
  );
  const target = join(OUT, forkName(fork.name).replace('@tusche/', ''));
  cpSync(unpacked, target, { recursive: true });
  rmSync(work, { recursive: true, force: true });
}

rmSync(RELEASE, { recursive: true, force: true });
run(['bunx', 'tsc', '-p', 'tsconfig.build.json']);
for (const dir of packageDirs) buildPackage(dir);
await buildPreviewClient();
for (const fork of forks) buildFork(fork);

/** Publish order: forks first, then each package after its dependencies. */
const order: string[] = forks.map((f) => forkName(f.name).replace('@tusche/', ''));
const pending = new Set(packageDirs);
const nameToDir = new Map([...manifests].map(([dir, m]) => [m.name as string, dir]));
while (pending.size > 0) {
  const ready = [...pending].filter((dir) =>
    Object.keys((manifests.get(dir)?.dependencies as Deps) ?? {})
      .map((name) => nameToDir.get(name))
      .every((dep) => dep === undefined || !pending.has(dep)),
  );
  if (ready.length === 0) throw new Error(`dependency cycle among ${[...pending].join(', ')}`);
  for (const dir of ready.sort()) {
    order.push(dir);
    pending.delete(dir);
  }
}
writeFileSync(join(OUT, 'publish-order.txt'), `${order.join('\n')}\n`);

/** Release notes: the section of CHANGELOG.md for this version. */
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
const section = changelog.split(/^## /m).find((part) => part.startsWith(`[${VERSION}]`));
if (!section) throw new Error(`CHANGELOG.md has no section ## [${VERSION}]`);
writeFileSync(join(RELEASE, 'notes.md'), `${section.slice(section.indexOf('\n') + 1).trim()}\n`);

console.log(
  `built ${order.length} packages at ${VERSION} into .release/packages:\n  ${order.join('\n  ')}`,
);
