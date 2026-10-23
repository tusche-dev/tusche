import { createHash } from 'node:crypto';
import { createReadStream, existsSync, type FSWatcher, watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { WebSocketServer } from 'ws';
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
const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_ENTRY = join(HERE, 'client', 'main.ts');
/** The page script built ahead of time (published package). */
const CLIENT_BUILT = join(HERE, 'client', 'client.js');
const INDEX_HTML = join(HERE, 'client', 'index.html');

let client: Promise<string> | undefined;

/** The page script: the built one, or built from source once per process under Bun. */
function clientScript(): Promise<string> {
  client ??= (async () => {
    if (existsSync(CLIENT_BUILT)) return readFile(CLIENT_BUILT, 'utf8');
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

  const send = (
    res: ServerResponse,
    status: number,
    body: string | Uint8Array,
    headers: Record<string, string> = {},
  ) => {
    res.writeHead(status, headers).end(body);
  };

  const handle = (req: IncomingMessage, res: ServerResponse) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname === '/ws') return send(res, 400, 'expected a WebSocket');
    if (pathname === '/') {
      return send(res, 200, html.replaceAll('{{file}}', escapeHtml(name)), {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
    }
    if (pathname === '/client.js') {
      return send(res, 200, script, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
    }
    if (pathname === '/canvaskit.wasm' || pathname.startsWith('/assets/')) {
      const path = previewFile(basename(pathname));
      if (!path) return send(res, 404, 'not found');
      res.writeHead(200, {
        'content-type': pathname.endsWith('.wasm')
          ? 'application/wasm'
          : 'application/octet-stream',
        'cache-control': 'max-age=86400',
      });
      createReadStream(path).pipe(res);
      return;
    }
    if (pathname.startsWith('/fonts/')) {
      const id = pathname.slice('/fonts/'.length);
      const font = loadedFontFiles().find((f) => f.id === id);
      if (!font) return send(res, 404, 'not found');
      return send(res, 200, font.data, {
        'content-type': 'application/octet-stream',
        'cache-control': 'max-age=31536000, immutable',
      });
    }
    send(res, 404, 'not found');
  };

  const host = options.host ?? '127.0.0.1';
  const ports =
    options.port === undefined
      ? Array.from({ length: PORT_ATTEMPTS }, (_, i) => DEFAULT_PORT + i)
      : [options.port];
  let server: Server | undefined;
  for (const port of ports) {
    try {
      server = await listen(createServer(handle), host, port);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || port === ports.at(-1)) throw e;
    }
  }
  if (!server) throw new Error('no free port');
  const srv = server;
  const sockets = new WebSocketServer({ server: srv, path: '/ws', perMessageDeflate: true });
  sockets.on('connection', (ws) => {
    // A new page gets the whole document (once the first load is done).
    void queue.then(() => {
      if (doc) ws.send(encodeMessage(update([...roots.values()])));
      if (error !== undefined) ws.send(encodeMessage(failure(error)));
    });
  });
  publish = (message) => {
    const data = encodeMessage(message);
    for (const ws of sockets.clients) if (ws.readyState === ws.OPEN) ws.send(data);
  };
  const port = (srv.address() as AddressInfo).port;

  await refresh();
  let watcher: FSWatcher | undefined = watch(dirname(file), (_event, changed) => {
    if (!changed || changed === name) schedule();
  });

  return {
    url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`,
    port,
    file,
    async close() {
      clearTimeout(timer);
      watcher?.close();
      watcher = undefined;
      await queue;
      for (const ws of sockets.clients) ws.terminate();
      await new Promise<void>((done) => sockets.close(() => done()));
      srv.closeAllConnections();
      await new Promise<void>((done) => srv.close(() => done()));
    },
  };
}

/** Starts listening; rejects on `EADDRINUSE` and other errors. */
function listen(server: Server, host: string, port: number): Promise<Server> {
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => {
      server.off('error', fail);
      done(server);
    });
  });
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
