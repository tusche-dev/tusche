import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createEngine } from '@tusche/engine';
import { createExecutor, type Executor } from '@tusche/exec';
import { type CallLogEntry, createServer } from '../src/index.ts';

const dir = mkdtempSync(join(tmpdir(), 'tusche-mcp-'));
let executor: Executor;
let client: Client;
const journal: CallLogEntry[] = [];

beforeAll(async () => {
  executor = createExecutor({
    engine: await createEngine({ allowNetwork: false, cacheDir: join(dir, 'cache') }),
    save: { delayMs: 20 },
  });
  const server = createServer({
    executor,
    cwd: dir,
    version: '0.0.0-test',
    onCall: (entry) => journal.push(entry),
  });
  client = new Client({ name: 'test', version: '1.0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientSide), server.connect(serverSide)]);
});

afterAll(async () => {
  await client.close();
});

type Content = { type: string; text?: string; data?: string; mimeType?: string };
interface Answer {
  content: Content[];
  isError?: boolean;
}

const call = async (name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as unknown as Answer;
const textOf = (answer: Answer) => answer.content[0]?.text ?? '';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('tusche MCP server', () => {
  test('lists the tools of 06-agent-api with undo and redo', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'execute',
      'get_app_state',
      'get_style',
      'lint',
      'open_document',
      'read_skill',
      'redo',
      'render',
      'save_document',
      'undo',
    ]);
    const execute = tools.find((t) => t.name === 'execute');
    expect(execute?.inputSchema).toMatchObject({
      type: 'object',
      properties: { input: { type: 'string' }, editId: { type: 'string' } },
    });
  });

  test('without a document: state says so, tools explain what to do', async () => {
    expect(textOf(await call('get_app_state'))).toContain('no document open');
    const answer = await call('execute', { input: 'Print(1)' });
    expect(answer.isError).toBe(true);
    expect(textOf(answer)).toContain('error: no document is open\nhint: call open_document');
    const missing = await call('open_document', { filePath: 'nope.pen' });
    expect(textOf(missing)).toContain('pass create: true');
  });

  test('skill and styles', async () => {
    expect(textOf(await call('read_skill'))).toStartWith('---\nname: tusche');
    expect(textOf(await call('read_skill', { path: 'execute.md' }))).toStartWith(
      '# The execute tool',
    );
    expect(textOf(await call('get_style'))).toContain('quiet-editorial — Quiet Editorial');
    const style = JSON.parse(
      textOf(await call('get_style', { name: 'quiet-editorial', params: { accent: 'olive' } })),
    );
    expect(style.palette.accent).toBe('#5F6B2E');
    expect((await call('get_style', { name: 'nope' })).isError).toBe(true);
  });

  test('scenario 1: create, build with a screenshot, fix with edits, undo, lint, saved', async () => {
    const opened = await call('open_document', { filePath: 'design/app.pen', create: true });
    expect(textOf(opened)).toContain('opened design/app.pen · version 2.21');
    expect(textOf(opened)).toContain('the document is empty');

    const built = await call('execute', {
      input: `screen = Insert(document, {type: "frame", name: "Onboarding", width: 390, height: 844, layout: "vertical", padding: 24, gap: 16, fill: "#F7F4EE", clip: true})
Insert(screen, {type: "text", name: "Title", content: "Welcome", fill: "#1B1A17", fontSize: 32})
TakeScreenshot([screen])`,
    });
    expect(built.isError).toBe(false);
    expect(textOf(built)).toMatch(/^ok · 2 inserted/);
    expect(built.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });

    const failed = await call('execute', {
      input: 'Insert(screen, {type: "text", name: "Body", content: "Hi", padding: 8})',
    });
    expect(failed.isError).toBe(true);
    const editId = /editId=(e\d+)/.exec(textOf(failed))?.[1];
    expect(editId).toBeDefined();
    const fixed = await call('execute', {
      editId,
      edits: [{ find: ', padding: 8', replace: ', fill: "#6B675F"' }],
    });
    expect(textOf(fixed)).toMatch(/^ok · 1 inserted/);

    const undone = await call('undo');
    expect(textOf(undone)).toContain('undo · 1 step · design/app.pen\n  undo 1 · redo 1');

    const state = textOf(await call('get_app_state'));
    expect(state).toContain('* design/app.pen · 1 top-level');

    const lint = textOf(await call('lint'));
    expect(lint).toMatch(/^lint · \d+ errors? · \d+ warnings?/);

    await call('save_document');
    const file = join(dir, 'design/app.pen');
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.children[0]).toMatchObject({
      name: 'Onboarding',
      children: [{ name: 'Title' }],
    });

    const id = saved.children[0].id as string;
    const rendered = await call('render', { nodeIds: [id], scale: 0.5 });
    expect(textOf(rendered)).toBe(`rendered 1 of 1:\n  ${id}`);
    expect(rendered.content[1]?.type).toBe('image');
    expect((await call('render', { nodeIds: ['nope'] })).isError).toBe(true);
  });

  test('execute takes input or editId + edits, not both', async () => {
    const both = await call('execute', { input: 'Print(1)', editId: 'e1', edits: [] });
    expect(textOf(both)).toContain('pass either input, or editId with edits');
    const half = await call('execute', { editId: 'e1' });
    expect(textOf(half)).toContain('editId and edits go together');
  });

  test('changes on disk: reload without unsaved changes, conflict with them', async () => {
    const file = join(dir, 'disk.pen');
    writeFileSync(file, '{\n  "version": "2.21",\n  "children": []\n}');
    await call('open_document', { filePath: 'disk.pen' });
    writeFileSync(
      file,
      '{\n  "version": "2.21",\n  "children": [{"type": "frame", "id": "ext01", "name": "Ext"}]\n}',
    );
    const reloaded = await call('execute', { input: 'Print(Get("ext01").name)' });
    expect(textOf(reloaded)).toStartWith('[reloaded] disk.pen changed on disk');
    expect(textOf(reloaded)).toContain('print:\n  Ext');

    await call('execute', { input: 'Insert(document, {type: "frame", name: "Mine"})' });
    writeFileSync(file, '{\n  "version": "2.21",\n  "children": []\n}');
    const conflict = await call('execute', { input: 'Print(1)' });
    expect(conflict.isError).toBe(true);
    expect(textOf(conflict)).toContain('changed on disk while this session has unsaved changes');
    expect(textOf(await call('get_app_state'))).toContain('CONFLICT');

    await call('save_document');
    expect(readFileSync(file, 'utf8')).toContain('"Mine"');
    await sleep(60);
  });

  test('delayed save writes the file shortly after a change', async () => {
    await call('open_document', { filePath: 'later.pen', create: true });
    await call('execute', { input: 'Insert(document, {type: "frame", name: "Soon"})' });
    const file = join(dir, 'later.pen');
    expect(readFileSync(file, 'utf8')).not.toContain('Soon');
    // A busy CI runner can take longer than the 20 ms delay.
    const saved = () => existsSync(file) && readFileSync(file, 'utf8').includes('Soon');
    for (let waited = 0; !saved() && waited < 2000; waited += 20) await sleep(20);
    expect(saved()).toBe(true);
  });

  test('every call goes to the journal with execute details', async () => {
    await call('open_document', { filePath: 'journal.pen', create: true });
    const from = journal.length;
    const failed = await call('execute', {
      input: 'Insert(document, {type: "frame", name: "A"})\nnope()',
    });
    const editId = /editId=(e\d+)/.exec(textOf(failed))?.[1] as string;
    await call('execute', {
      editId,
      edits: [{ find: 'nope()', replace: 'Print(1)' }],
    });
    await call('undo', { steps: 1 });
    await call('get_style', { name: 'missing' });
    const entries = journal.slice(from).map(({ t, ms, ...rest }) => {
      expect(Date.parse(t)).toBeGreaterThan(0);
      expect(ms).toBeGreaterThanOrEqual(0);
      return rest;
    });
    expect(entries).toEqual([
      {
        tool: 'execute',
        ok: false,
        editId,
        counts: expect.any(Object),
        warnings: [],
        images: 0,
      },
      {
        tool: 'execute',
        ok: true,
        retryOf: editId,
        counts: expect.objectContaining({ inserted: 1 }),
        warnings: expect.any(Array),
        images: 0,
      },
      { tool: 'undo', ok: true, steps: 1 },
      { tool: 'get_style', ok: false, style: 'missing' },
    ]);
  });
});
