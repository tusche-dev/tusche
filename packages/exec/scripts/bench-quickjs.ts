/**
 * QuickJS builds for `execute` (ADR-003, ADR-008): sync vs asyncify, QuickJS vs QuickJS-ng.
 *
 *   bun packages/exec/scripts/bench-quickjs.ts
 *
 * Measures module load, a fresh runtime + context per call, 10⁴ host calls with JSON
 * arguments, and a visitor over 1000 nodes that are pulled from the host one by one.
 */
import ngAsync from '@jitl/quickjs-ng-wasmfile-release-asyncify';
import ngSync from '@jitl/quickjs-ng-wasmfile-release-sync';
import qjsAsync from '@jitl/quickjs-wasmfile-release-asyncify';
import qjsSync from '@jitl/quickjs-wasmfile-release-sync';
import {
  newQuickJSAsyncWASMModuleFromVariant,
  newQuickJSWASMModuleFromVariant,
  type QuickJSAsyncContext,
  type QuickJSContext,
  type QuickJSHandle,
} from 'quickjs-emscripten-core';

const NODES = 1000;
const CALLS = 10_000;
const ROUNDS = 5;

/** A flat tree: node i has children 2i+1 and 2i+2. */
const node = (i: number) =>
  JSON.stringify({
    id: `n${i}`,
    type: i % 3 === 0 ? 'text' : 'frame',
    name: `Node ${i}`,
    width: 100 + i,
    height: 40,
    fill: '#FFFFFF',
    children: [2 * i + 1, 2 * i + 2].filter((c) => c < NODES).map((c) => `n${c}`),
  });

const CALLS_SNIPPET = `
let total = 0
for (let i = 0; i < ${CALLS}; i++) total += JSON.parse(__host(JSON.stringify({ i }))).i
total`;

const VISIT_SNIPPET = `
const out = []
const visit = (id, depth) => {
  const n = JSON.parse(__node(id))
  if (n.type === 'text') out.push(n.id)
  for (const c of n.children) visit(c, depth + 1)
}
visit('n0', 0)
out.length`;

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1] ?? 0;
const ms = (value: number) => `${value.toFixed(1)} мс`;

interface Row {
  build: string;
  load: number;
  context: number;
  calls: number;
  visit: number;
}

type Install = (ctx: QuickJSContext) => void;

function installSync(ctx: QuickJSContext) {
  const host = ctx.newFunction('__host', (arg: QuickJSHandle) => ctx.newString(ctx.getString(arg)));
  ctx.setProp(ctx.global, '__host', host);
  host.dispose();
  const get = ctx.newFunction('__node', (arg: QuickJSHandle) =>
    ctx.newString(node(Number(ctx.getString(arg).slice(1)))),
  );
  ctx.setProp(ctx.global, '__node', get);
  get.dispose();
}

/**
 * `suspend`: every call returns a promise and suspends the VM (the worst case for asyncify).
 * Otherwise the host answers synchronously, as most `execute` calls do (layout is warm).
 */
function installAsync(ctx: QuickJSAsyncContext, suspend: boolean) {
  // A plain return does not suspend the VM; only a returned promise does. The typings
  // ask for a promise, the runtime accepts both.
  const answer = (value: () => string) =>
    (suspend
      ? Promise.resolve().then(() => ctx.newString(value()))
      : ctx.newString(value())) as Promise<QuickJSHandle>;
  const host = ctx.newAsyncifiedFunction('__host', (arg: QuickJSHandle) => {
    const text = ctx.getString(arg);
    return answer(() => text);
  });
  ctx.setProp(ctx.global, '__host', host);
  host.dispose();
  const get = ctx.newAsyncifiedFunction('__node', (arg: QuickJSHandle) => {
    const id = Number(ctx.getString(arg).slice(1));
    return answer(() => node(id));
  });
  ctx.setProp(ctx.global, '__node', get);
  get.dispose();
}

async function benchSync(build: string, variant: typeof qjsSync, install: Install): Promise<Row> {
  let started = performance.now();
  const module = await newQuickJSWASMModuleFromVariant(variant);
  const load = performance.now() - started;
  const contexts: number[] = [];
  const calls: number[] = [];
  const visits: number[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    started = performance.now();
    // The context owns its runtime: disposing a separate runtime with live host
    // functions trips an assertion in the asyncify build (0.32.0).
    const ctx = module.newContext();
    ctx.runtime.setMemoryLimit(256 * 1024 * 1024);
    install(ctx);
    contexts.push(performance.now() - started);
    for (const [snippet, times] of [
      [CALLS_SNIPPET, calls],
      [VISIT_SNIPPET, visits],
    ] as const) {
      started = performance.now();
      ctx.unwrapResult(ctx.evalCode(snippet, 'snippet.js')).dispose();
      times.push(performance.now() - started);
    }
    ctx.dispose();
  }
  return { build, load, context: median(contexts), calls: median(calls), visit: median(visits) };
}

async function benchAsync(build: string, variant: typeof qjsAsync, suspend: boolean): Promise<Row> {
  let started = performance.now();
  const module = await newQuickJSAsyncWASMModuleFromVariant(variant);
  const load = performance.now() - started;
  const contexts: number[] = [];
  const calls: number[] = [];
  const visits: number[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    started = performance.now();
    // The context owns its runtime: disposing a separate runtime with live host
    // functions trips an assertion in the asyncify build (0.32.0).
    const ctx = module.newContext();
    ctx.runtime.setMemoryLimit(256 * 1024 * 1024);
    installAsync(ctx, suspend);
    contexts.push(performance.now() - started);
    for (const [snippet, times] of [
      [CALLS_SNIPPET, calls],
      [VISIT_SNIPPET, visits],
    ] as const) {
      started = performance.now();
      ctx.unwrapResult(await ctx.evalCodeAsync(snippet, 'snippet.js')).dispose();
      times.push(performance.now() - started);
    }
    ctx.dispose();
  }
  return { build, load, context: median(contexts), calls: median(calls), visit: median(visits) };
}

const rows = [
  await benchSync('quickjs sync', qjsSync, installSync),
  await benchSync('quickjs-ng sync', ngSync, installSync),
  await benchAsync('quickjs asyncify, хост синхронный', qjsAsync, false),
  await benchAsync('quickjs-ng asyncify, хост синхронный', ngAsync, false),
  await benchAsync('quickjs asyncify, каждый вызов ждёт', qjsAsync, true),
  await benchAsync('quickjs-ng asyncify, каждый вызов ждёт', ngAsync, true),
];

console.log(
  `| Сборка | Загрузка модуля | Рантайм + контекст | ${CALLS} хост-вызовов | Visitor, ${NODES} нод |`,
);
console.log('|---|---|---|---|---|');
for (const row of rows) {
  console.log(
    `| ${row.build} | ${ms(row.load)} | ${ms(row.context)} | ${ms(row.calls)} | ${ms(row.visit)} |`,
  );
}
