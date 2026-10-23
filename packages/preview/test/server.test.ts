import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine, decodeMessage, type Engine, type PreviewMessage } from '@tusche/engine';
import { writeAtomic } from '@tusche/exec';
import { type PreviewServer, startPreview } from '../src/index.ts';

let engine: Engine;
let dir: string;
let server: PreviewServer | undefined;
const sockets: WebSocket[] = [];

beforeAll(async () => {
  engine = await createEngine({
    allowNetwork: false,
    cacheDir: mkdtempSync(join(tmpdir(), 'tusche-preview-cache-')),
  });
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await server?.close();
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

const rect = (id: string, x: number, fill: string) => ({
  type: 'rectangle',
  id,
  x,
  y: 0,
  width: 100,
  height: 60,
  fill,
});

const pen = (children: unknown[]) => `${JSON.stringify({ version: '2.21', children }, null, 2)}\n`;

async function start(children: unknown[]): Promise<{ file: string; preview: PreviewServer }> {
  dir = mkdtempSync(join(tmpdir(), 'tusche-preview-'));
  const file = join(dir, 'design.pen');
  await writeAtomic(file, pen(children));
  server = await startPreview({ file, port: 0, engine, debounceMs: 20 });
  return { file, preview: server };
}

/** A page connected to the server: its messages in order. */
function connect(preview: PreviewServer) {
  const socket = new WebSocket(`${preview.url.replace('http', 'ws')}ws`);
  sockets.push(socket);
  const received: PreviewMessage[] = [];
  const waiting: ((message: PreviewMessage) => void)[] = [];
  socket.onmessage = (event) => {
    const message = decodeMessage(String(event.data));
    const resolve = waiting.shift();
    if (resolve) resolve(message);
    else received.push(message);
  };
  const next = (): Promise<PreviewMessage> => {
    const ready = received.shift();
    if (ready) return Promise.resolve(ready);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no message within 5 s')), 5000);
      waiting.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  };
  return { next };
}

const updateOf = (message: PreviewMessage) => {
  if (message.type !== 'update')
    throw new Error(`expected an update, got: ${JSON.stringify(message)}`);
  return message;
};

describe('preview server', () => {
  test('a new page gets the whole document; a change sends only the changed root', async () => {
    const { file, preview } = await start([rect('a', 0, '#FF0000'), rect('b', 200, '#00FF00')]);
    const page = connect(preview);
    const first = updateOf(await page.next());
    expect(first.file).toBe('design.pen');
    expect(first.order).toEqual(['a', 'b']);
    expect(first.roots.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(first.roots.find((r) => r.id === 'b')?.nodes[0]).toMatchObject({ x: 200, width: 100 });
    expect(first.fonts.length).toBeGreaterThan(0);

    // As the MCP server writes: a temporary file, then a rename.
    await writeAtomic(
      file,
      pen([rect('a', 0, '#FF0000'), rect('b', 200, '#0000FF'), rect('c', 400, '#000000')]),
    );
    const second = updateOf(await page.next());
    expect(second.order).toEqual(['a', 'b', 'c']);
    expect(second.roots.map((r) => r.id).sort()).toEqual(['b', 'c']);

    await writeAtomic(file, pen([rect('c', 400, '#000000'), rect('a', 0, '#FF0000')]));
    const third = updateOf(await page.next());
    expect(third.order).toEqual(['c', 'a']);
    expect(third.roots).toEqual([]);
  });

  test('instances follow a changed component in another root', async () => {
    const component = (fill: string) => ({ ...rect('comp', 0, fill), reusable: true });
    const use = { type: 'ref', id: 'use', ref: 'comp', x: 300, y: 0 };
    const { file, preview } = await start([
      component('#FF0000'),
      use,
      rect('other', 600, '#000000'),
    ]);
    const page = connect(preview);
    await page.next();
    await writeAtomic(file, pen([component('#00FF00'), use, rect('other', 600, '#000000')]));
    const update = updateOf(await page.next());
    expect(update.roots.map((r) => r.id).sort()).toEqual(['comp', 'use']);
  });

  test('a broken file keeps the last state and reports an error, also to new pages', async () => {
    const { file, preview } = await start([rect('a', 0, '#FF0000')]);
    const page = connect(preview);
    await page.next();
    await writeAtomic(file, '{ "version": "2.21", "children": [');
    const error = await page.next();
    expect(error.type).toBe('error');

    const late = connect(preview);
    expect(updateOf(await late.next()).roots.map((r) => r.id)).toEqual(['a']);
    expect((await late.next()).type).toBe('error');

    await writeAtomic(file, pen([rect('a', 0, '#FF0000')]));
    expect(updateOf(await page.next()).roots).toEqual([]);

    rmSync(file);
    const gone = await page.next();
    expect(gone).toMatchObject({ type: 'error', message: 'design.pen not found' });
  });

  test('serves the page, its script, CanvasKit, bundled and loaded fonts', async () => {
    const { preview } = await start([rect('a', 0, '#FF0000')]);
    const get = (path: string) => fetch(new URL(path, preview.url));

    const html = await (await get('/')).text();
    expect(html).toContain('<title>design.pen · Tusche preview</title>');
    const script = await get('/client.js');
    expect(script.status).toBe(200);
    expect((await script.text()).length).toBeGreaterThan(100_000);

    const wasm = new Uint8Array(await (await get('/canvaskit.wasm')).arrayBuffer());
    expect([...wasm.subarray(0, 4)]).toEqual([0, 0x61, 0x73, 0x6d]);
    expect((await get('/assets/Inter-Regular.ttf')).status).toBe(200);
    expect((await get('/assets/..%2Fpackage.json')).status).toBe(404);

    const { fonts } = updateOf(await connect(preview).next());
    const font = fonts[0];
    if (!font) throw new Error('no fonts');
    const bytes = await (await get(`/fonts/${font.id}`)).arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect((await get('/fonts/0000000000000000')).status).toBe(404);
    expect((await get('/nothing')).status).toBe(404);
  });

  test('a busy port is an error when the port is given', async () => {
    const { preview } = await start([]);
    await expect(
      startPreview({ file: preview.file, port: preview.port, engine }),
    ).rejects.toThrow();
  });
});
