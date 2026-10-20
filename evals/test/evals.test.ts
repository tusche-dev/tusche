import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { compare, taskMismatch } from '../src/compare.ts';
import { changedLines, outOfScope } from '../src/diff.ts';
import { callMetrics, type Score, sessionMetrics } from '../src/score.ts';
import { shuffle } from '../src/sheet.ts';
import { type Metrics, totals } from '../src/summary.ts';
import { loadTasks, REPO } from '../src/tasks.ts';

describe('tasks', () => {
  test('10 screens and 5 edits; edit fixtures exist', () => {
    const tasks = loadTasks();
    expect(tasks.filter((t) => t.kind === 'screen')).toHaveLength(10);
    const edits = tasks.filter((t) => t.kind === 'edit');
    expect(edits).toHaveLength(5);
    for (const edit of edits) expect(existsSync(join(REPO, edit.fixture as string))).toBe(true);
  });
});

describe('diff', () => {
  test('changed lines: added plus removed, common head and tail skipped', () => {
    expect(changedLines('a\nb\nc', 'a\nb\nc')).toBe(0);
    expect(changedLines('a\nb\nc', 'a\nB\nc')).toBe(2);
    expect(changedLines('a\nc', 'a\nb\nc')).toBe(1);
    expect(changedLines('a\nb\nc\nd', 'a\nc\nb\nd')).toBe(0);
  });

  test('out of scope: roots and variables', () => {
    const before = {
      variables: { x: 1 },
      children: [
        { id: 'A', n: 1 },
        { id: 'B', n: 1 },
      ],
    };
    const after = { variables: { x: 2 }, children: [{ id: 'A', n: 2 }, { id: 'C' }] };
    expect(outOfScope(before, after, ['A'])).toEqual(['variables', 'B', 'C']);
    expect(outOfScope(before, after, ['A', 'B', 'C', 'variables'])).toEqual([]);
  });

  test('out of scope: a variable used only by the scoped roots may change', () => {
    const before = {
      variables: { r: 14, c: '#000' },
      children: [
        { id: 'A', cornerRadius: '$r', fill: '$c' },
        { id: 'B', fill: '$c' },
      ],
    };
    const radius = { ...before, variables: { r: 18, c: '#000' } };
    expect(outOfScope(before, radius, ['A'])).toEqual([]);
    const color = { ...before, variables: { r: 14, c: '#111' } };
    expect(outOfScope(before, color, ['A'])).toEqual(['variables']);
    expect(outOfScope(before, { ...before, themes: { mode: ['dark'] } }, ['A'])).toEqual([
      'variables',
    ]);
  });
});

describe('score', () => {
  test('call journal', () => {
    const metrics = callMetrics([
      { tool: 'read_skill', ok: true, path: 'SKILL.md' },
      { tool: 'get_style', ok: true },
      { tool: 'get_style', ok: true, style: 'blueprint' },
      { tool: 'execute', ok: false, editId: 'e1' },
      { tool: 'execute', ok: true, retryOf: 'e1' },
      { tool: 'undo', ok: true, steps: 1 },
    ]);
    expect(metrics).toEqual({
      total: 6,
      execute: 2,
      failed: 1,
      retries: 1,
      undo: 1,
      render: 0,
      lint: 0,
      skill: ['SKILL.md'],
      styles: ['blueprint'],
    });
  });

  test('stream-json transcript', () => {
    const session = sessionMetrics([
      { type: 'system', subtype: 'init', model: 'claude-x' },
      {
        type: 'result',
        subtype: 'error_max_turns',
        is_error: true,
        num_turns: 80,
        total_cost_usd: 1.5,
        duration_ms: 1000,
        usage: {
          input_tokens: 1,
          output_tokens: 2,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 4,
        },
      },
    ]);
    expect(session).toMatchObject({
      model: 'claude-x',
      turns: 80,
      totalTokens: 10,
      error: 'error_max_turns',
    });
    expect(sessionMetrics([])).toBeNull();
  });
});

const score = (task: string, error: number, tokens: number): Score => ({
  task,
  kind: 'screen',
  produced: true,
  doc: { roots: 1, nodes: 1, placeholders: 0, error, warning: 0, layout: 0, fonts: 0, codes: {} },
  calls: null,
  session: {
    model: 'm',
    turns: 1,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: tokens,
    costUsd: 0,
    durationMs: 0,
    error: null,
  },
  edit: null,
  renders: [],
});

const metrics = (runs: Score[]): Metrics => ({
  label: 'x',
  date: '',
  skillVersion: '0',
  model: 'm',
  totals: totals(runs),
  runs,
});

describe('compare', () => {
  test('equal runs pass; more errors or 15 %+ more tokens fail', () => {
    const base = metrics([score('a', 1, 1000)]);
    expect(compare(base, base).some((r) => r.worse)).toBe(false);
    expect(compare(base, metrics([score('a', 1, 1140)])).some((r) => r.worse)).toBe(false);
    const worse = compare(base, metrics([score('a', 2, 1200)])).filter((r) => r.worse);
    expect(worse.map((r) => r.key)).toEqual(['error', 'totalTokens']);
    expect(taskMismatch(base, metrics([score('b', 0, 0)]))).toEqual(['a', 'b']);
  });
});

describe('sheet', () => {
  test('shuffle is a deterministic permutation', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const once = shuffle(items, 42);
    expect(shuffle(items, 42)).toEqual(once);
    expect([...once].sort((a, b) => a - b)).toEqual(items);
  });
});
