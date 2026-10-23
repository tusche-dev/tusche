import { createHash } from 'node:crypto';
import { type FSWatcher, watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import {
  createEngine,
  type Engine,
  encodeMessage,
  loadedFontFiles,
  type PreviewMessage,
  previewFile,
  type RootSnapshot,
  type Scene,
  snapshotRoot,
} from '@tusche/engine';
import { rootsBetween } from '@tusche/exec';
import { migratePen, type PenDocument, parsePen } from '@tusche/pen-format';
import type { Server, ServerWebSocket } from 'bun';
import { shareUnchanged } from './diff.ts';

export interface PreviewOptions {
  /** The `.pen` file to show. */
  file: string;
  /** Port; without one the first free port from 4848 is taken. `0` — any free port. */
  port?: number;
  /** Interface to listen on. Default `127.0.0.1`. */
  host?: string;
  /** Engine to lay the document out with. Default: a new one (fonts from the network unless `TUSCHE_FONTS_OFFLINE=1`). */
  engine?: Engine;
  /** Fetch `http(s)` images. Default `TUSCHE_ALLOW_REMOTE_ASSETS === '1'`. */
  allowRemoteAssets?: boolean;
  /** Wait after a change of the file before reading it. Default 100 ms. */
  debounceMs?: number;
  /** Where to report reloads and problems. */
  log?: (line: string) => void;
}

export interface PreviewServer {
  url: string;
  port: number;
  /** Absolute path of the file shown. */
  file: string;
  close(): Promise<void>;
}

const DEFAULT_PORT = 4848;
const PORT_ATTEMPTS = 20;
const TOPIC = 'preview';
const CLIENT_ENTRY = join(import.meta.dir, 'client', 'main.ts');
const INDEX_HTML = join(import.meta.dir, 'client', 'index.html');

let client: Promise<string> | undefined;

/** The page script, built once per process. */
function clientScript(): Promise<string> {
  client ??= (async () => {
    const result = await Bun.build({
      entrypoints: [CLIENT_ENTRY],
      target: 'browser',
      minify: true,
    });
    const output = result.outputs[0];
    if (!result.success || !output) {
      throw new Error(`preview page build failed: ${result.logs.map(String).join('\n')}`);
    }
    return output.text();
  })();
  return client;
}

/**
 * Serves a page that shows a `.pen` file and follows its changes: the file is watched,
 * read again and laid out by the engine, and the top-level nodes that changed go to every
 * open page over a WebSocket. A file that cannot be read keeps the last good state on screen.
 */
export async function startPreview(options: PreviewOptions): Promise<PreviewServer> {
  const file = resolve(options.file);
  const name = basename(file);
  const log = options.log ?? (() => {});
  const debounceMs = options.debounceMs ?? 100;
  const allowRemoteAssets =
    options.allowRemoteAssets ?? process.env.TUSCHE_ALLOW_REMOTE_ASSETS === '1';
  const [engine, script, html] = await Promise.all([
    options.engine ?? createEngine({ allowNetwork: process.env.TUSCHE_FONTS_OFFLINE !== '1' }),
    clientScript(),
    readFile(INDEX_HTML, 'utf8'),
  ]);

  let doc: PenDocument | undefined;
  let scene: Scene | undefined;
  const roots = new Map<string, RootSnapshot>();
  let lastHash: string | undefined;
  let error: string | undefined;
  let queue: Promise<void> = Promise.resolve();
  let publish = (_message: PreviewMessage) => {};

  const fonts = () => loadedFontFiles().map(({ id, family, style }) => ({ id, family, style }));
  const update = (changed: RootSnapshot[]): PreviewMessage => ({
    type: 'update',
    file: name,
    order: doc?.children.map((node) => node.id) ?? [],
    roots: changed,
    fonts: fonts(),
  });
  const failure = (message: string): PreviewMessage => ({ type: 'error', file: name, message });

  /** Reads the file and sends what changed; one load at a time. */
  async function load(): Promise<void> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      report(code === 'ENOENT' ? `${name} not found` : (e as Error).message);
      lastHash = undefined;
      return;
    }
    const hash = createHash('sha1').update(text).digest('hex');
    if (hash === lastHash) return;
    lastHash = hash;

    let next: PenDocument;
    try {
      next = migratePen(parsePen(text).doc).doc;
    } catch (e) {
      report((e as Error).message);
      return;
    }
    const started = performance.now();
    let changed: string[];
    if (!scene || !doc) {
      scene = await engine.open(next, { baseDir: dirname(file), allowRemoteAssets });
      doc = next;
      changed = scene.projection.topLevelIds;
    } else {
      const shared = shareUnchanged(doc, next);
      const affected = rootsBetween(doc, shared);
      await scene.update(shared, affected);
      doc = shared;
      const top = scene.projection.topLevelIds;
      changed = affected === 'all' ? top : top.filter((id) => affected.has(id));
    }
    const order = new Set(scene.projection.topLevelIds);
    for (const id of [...roots.keys()]) if (!order.has(id)) roots.delete(id);
    const snapshots: RootSnapshot[] = [];
    for (const id of changed) {
      const snapshot = await snapshotRoot(scene, id);
      if (snapshot) {
        roots.set(id, snapshot);
        snapshots.push(snapshot);
      } else {
        roots.delete(id);
      }
    }
    error = undefined;
    publish(update(snapshots));
    log(
      `${name}: ${snapshots.length} of ${order.size} top-level nodes updated in ${Math.round(performance.now() - started)} ms`,
    );
  }

  function report(message: string): void {
    error = message;
    publish(failure(message));
    log(`${name}: ${message}`);
  }

  const refresh = () => {
    queue = queue.then(load).catch((e: Error) => report(e.message));
    return queue;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, debounceMs);
  };

  const fetch = (request: Request, srv: Server<undefined>): Response | undefined => {
    const { pathname } = new URL(request.url);
    if (pathname === '/ws') {
      return srv.upgrade(request)
        ? undefined
        : new Response('expected a WebSocket', { status: 400 });
    }
    if (pathname === '/') {
      return new Response(html.replaceAll('{{file}}', escapeHtml(name)), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    if (pathname === '/client.js') {
      return new Response(script, {
        headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    if (pathname === '/canvaskit.wasm' || pathname.startsWith('/assets/')) {
      const path = previewFile(basename(pathname));
      if (!path) return notFound();
      return new Response(Bun.file(path), { headers: { 'cache-control': 'max-age=86400' } });
    }
    if (pathname.startsWith('/fonts/')) {
      const id = pathname.slice('/fonts/'.length);
      const font = loadedFontFiles().find((f) => f.id === id);
      if (!font) return notFound();
      return new Response(font.data, {
        headers: {
          'content-type': 'application/octet-stream',
          'cache-control': 'max-age=31536000, immutable',
        },
      });
    }
    return notFound();
  };

  const websocket = {
    perMessageDeflate: true,
    open(ws: ServerWebSocket<undefined>) {
      ws.subscribe(TOPIC);
      // A new page gets the whole document (once the first load is done).
      void queue.then(() => {
        if (doc) ws.send(encodeMessage(update([...roots.values()])));
        if (error !== undefined) ws.send(encodeMessage(failure(error)));
      });
    },
    message() {},
  };

  const host = options.host ?? '127.0.0.1';
  const ports =
    options.port === undefined
      ? Array.from({ length: PORT_ATTEMPTS }, (_, i) => DEFAULT_PORT + i)
      : [options.port];
  let server: Server<undefined> | undefined;
  for (const port of ports) {
    try {
      server = Bun.serve({ hostname: host, port, fetch, websocket });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || port === ports.at(-1)) throw e;
    }
  }
  if (!server) throw new Error('no free port');
  const srv = server;
  publish = (message) => srv.publish(TOPIC, encodeMessage(message));

  await refresh();
  let watcher: FSWatcher | undefined = watch(dirname(file), (_event, changed) => {
    if (!changed || changed === name) schedule();
  });

  return {
    url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${srv.port}/`,
    port: srv.port as number,
    file,
    async close() {
      clearTimeout(timer);
      watcher?.close();
      watcher = undefined;
      await queue;
      await srv.stop(true);
    },
  };
}

const notFound = () => new Response('not found', { status: 404 });

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
