import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const dir = mkdtempSync(join(tmpdir(), 'tusche-cli-'));
const entry = resolve(import.meta.dir, '../src/index.ts');
const env = {
  ...process.env,
  TUSCHE_FONTS_OFFLINE: '1',
  TUSCHE_CACHE_DIR: join(dir, 'cache'),
} as Record<string, string>;

async function tusche(args: string[], stdin?: string) {
  const proc = Bun.spawn(['bun', entry, ...args], {
    cwd: dir,
    env,
    stdin: stdin === undefined ? 'ignore' : new Response(stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

const write = (name: string, doc: unknown) => {
  writeFileSync(join(dir, name), JSON.stringify(doc, null, 2));
  return name;
};

const CARD = {
  version: '2.21',
  children: [
    {
      type: 'frame',
      id: 'card',
      width: 120,
      height: 60,
      fill: '#FFFFFF',
      children: [{ type: 'text', id: 'pale', content: 'Pale', fill: '#F4F4F4', fontSize: 16 }],
    },
  ],
};

describe('tusche CLI', () => {
  test('help, version, unknown command', async () => {
    expect((await tusche(['--help'])).stdout).toContain('usage: tusche <command>');
    const { version } = JSON.parse(
      readFileSync(resolve(import.meta.dir, '../package.json'), 'utf8'),
    );
    expect((await tusche(['--version'])).stdout.trim()).toBe(version);
    const unknown = await tusche(['nope']);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('unknown command "nope"');
    expect((await tusche(['lint'])).code).toBe(2);
  });

  test('exec runs a snippet, saves the file and writes screenshots', async () => {
    const result = await tusche(
      ['exec', 'new.pen', '-', '--create', '--out', 'shots'],
      'f = Insert(document, {type: "frame", name: "Box", width: 40, height: 40, fill: "#000000"})\nTakeScreenshot([f])',
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^ok · 1 inserted/);
    const doc = JSON.parse(readFileSync(join(dir, 'new.pen'), 'utf8'));
    expect(doc.children[0].name).toBe('Box');
    expect(existsSync(join(dir, 'shots', `${doc.children[0].id}.png`))).toBe(true);

    writeFileSync(join(dir, 'bad.js'), 'Insert(document, {type: "text", padding: 4})');
    const failed = await tusche(['exec', 'new.pen', 'bad.js']);
    expect(failed.code).toBe(1);
    expect(failed.stdout).toContain('error · rolled back');
  });

  test('render and export', async () => {
    write('card.pen', CARD);
    const render = await tusche(['render', 'card.pen', '--out', 'r', '--scale', '2']);
    expect(render.code).toBe(0);
    expect(render.stdout.trim()).toBe('r/card.png');
    const png = readFileSync(join(dir, 'r', 'card.png'));
    expect(png.readUInt32BE(16)).toBe(240);

    const missing = await tusche(['render', 'card.pen', '--node', 'nope']);
    expect(missing.code).toBe(1);

    const svg = await tusche([
      'export',
      'card.pen',
      '--format',
      'svg',
      '--node',
      'card',
      '--out',
      'out/card',
    ]);
    expect(svg.code).toBe(0);
    expect(readFileSync(join(dir, 'out', 'card.svg'), 'utf8')).toContain('<svg');
    expect((await tusche(['export', 'card.pen', '--format', 'pdf', '--out', 'x'])).code).toBe(2);
  });

  test('lint exits 1 on errors; json output', async () => {
    write('lint.pen', CARD);
    const text = await tusche(['lint', 'lint.pen']);
    expect(text.code).toBe(1);
    expect(text.stdout).toContain('error [op/color-contrast] pale:');
    const json = await tusche(['lint', 'lint.pen', '--format', 'json']);
    expect(JSON.parse(json.stdout)[0]).toMatchObject({ level: 'error', path: 'pale' });
    write('clean.pen', { version: '2.21', children: [] });
    expect((await tusche(['lint', 'clean.pen'])).code).toBe(0);
  });

  test('validate and migrate', async () => {
    write('invalid.pen', { version: '2.21', children: [{ type: 'frame', id: 'a/b' }] });
    const invalid = await tusche(['validate', 'invalid.pen']);
    expect(invalid.code).toBe(1);
    expect(invalid.stdout).toContain('error invalid-id');
    writeFileSync(join(dir, 'broken.pen'), '{"version": ');
    expect((await tusche(['validate', 'broken.pen'])).stdout).toContain('error parse:');

    write('old.pen', { version: '2.6', children: [] });
    const dry = await tusche(['migrate', 'old.pen', '--dry-run']);
    expect(dry.stdout).toContain('2.6 → 2.21');
    expect(JSON.parse(readFileSync(join(dir, 'old.pen'), 'utf8')).version).toBe('2.6');
    await tusche(['migrate', 'old.pen']);
    expect(JSON.parse(readFileSync(join(dir, 'old.pen'), 'utf8')).version).toBe('2.21');
    expect((await tusche(['migrate', 'old.pen'])).stdout).toContain('nothing to do');
  });

  test('mcp serves the tools over stdio and saves before exiting', async () => {
    const transport = new StdioClientTransport({
      command: 'bun',
      args: [entry, 'mcp'],
      cwd: dir,
      env: { ...getDefaultEnvironment(), ...env },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'test', version: '1.0' });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('execute');
    await client.callTool({
      name: 'open_document',
      arguments: { filePath: 'mcp.pen', create: true },
    });
    const answer = (await client.callTool({
      name: 'execute',
      arguments: { input: 'Insert(document, {type: "frame", name: "ViaMcp"})' },
    })) as { content: { text: string }[] };
    expect(answer.content[0]?.text).toMatch(/^ok · 1 inserted/);
    await client.close();
    // The delayed write is flushed when the client goes away.
    for (let i = 0; i < 50 && !readFileSync(join(dir, 'mcp.pen'), 'utf8').includes('ViaMcp'); i++) {
      await Bun.sleep(50);
    }
    expect(readFileSync(join(dir, 'mcp.pen'), 'utf8')).toContain('ViaMcp');
  }, 30_000);
});

describe('tusche preview', () => {
  test('without a file or with a missing one: usage error', async () => {
    const none = await tusche(['preview']);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain('preview needs a .pen file');
    expect((await tusche(['preview', 'missing.pen'])).code).toBe(2);
    expect((await tusche(['preview', write('p.pen', CARD), '--port', 'x'])).code).toBe(2);
  });

  test('serves the page until stopped', async () => {
    const file = write('preview.pen', CARD);
    const proc = Bun.spawn(['bun', entry, 'preview', file, '--port', '0'], {
      cwd: dir,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    try {
      const reader = proc.stdout.getReader();
      let out = '';
      while (!out.includes('\n')) {
        const { value, done } = await reader.read();
        if (done) break;
        out += new TextDecoder().decode(value);
      }
      const url = out.match(/at (http:\/\/\S+)/)?.[1];
      expect(url).toBeDefined();
      const page = await fetch(url as string);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('preview.pen · Tusche preview');
    } finally {
      proc.kill();
      await proc.exited;
    }
  });
});
