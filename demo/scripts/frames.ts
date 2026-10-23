// Renders the pictures the demo video shows into demo/public/frames with the Tusche CLI.
//
//   bun demo/scripts/frames.ts
//
// The designs in demo/sources are real results of the skill evals (skill 0.1.1, ADR-010).
// The build of the habit-tracker screen is shown in stages: each stage is the final file
// without the sections the agent had not built yet, in the order it built them.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const DEMO = resolve(import.meta.dir, '..');
const CLI = join(DEMO, '..', 'packages', 'cli', 'src', 'index.ts');
const SOURCES = join(DEMO, 'sources');
const OUT = join(DEMO, 'public', 'frames');

interface PenNode {
  id: string;
  children?: PenNode[];
}

function render(file: string, node: string, name: string, scale: number): void {
  const dir = join(tmpdir(), `tusche-demo-${name}`);
  rmSync(dir, { recursive: true, force: true });
  const proc = Bun.spawnSync(
    [
      'bun',
      CLI,
      'render',
      file,
      '--node',
      node,
      '--scale',
      String(scale),
      '--max-side',
      '4000',
      '--out',
      dir,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  if (proc.exitCode !== 0) throw new Error(`render ${name} failed:\n${proc.stderr.toString()}`);
  renameSync(join(dir, `${node}.png`), join(OUT, `${name}.png`));
  rmSync(dir, { recursive: true, force: true });
  console.log(`${name}.png`);
}

/** The document without the given nodes. */
function without(doc: { children: PenNode[] }, ids: string[]) {
  const drop = new Set(ids);
  const prune = (nodes: PenNode[]): PenNode[] =>
    nodes
      .filter((n) => !drop.has(n.id))
      .map((n) => (n.children ? { ...n, children: prune(n.children) } : n));
  return { ...doc, children: prune(doc.children) };
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// The habit tracker, stage by stage (ids from demo/sources/mobile-tabs.pen).
const habits = join(SOURCES, 'mobile-tabs.pen');
const doc = JSON.parse(readFileSync(habits, 'utf8')) as { children: PenNode[] };
const HOME = 'mR2if';
const STAGES: [string, string[]][] = [
  ['home-0', ['FRbaw', 'ldCl7', 'F1MOW', 'hX7hN', 'Elzta']], // the empty phone frame
  ['home-1', ['F1MOW', 'hX7hN', 'Elzta']], // status bar and header
  ['home-2', ['hX7hN', 'Elzta']], // + streak card
  ['home-3', ['adNJG', 'h7ynG', '0Ukxu', 'Elzta']], // + today, first habits
  ['home-4', ['Elzta']], // + all habits
  ['home-5', []], // + tab bar
];
for (const [name, ids] of STAGES) {
  const file = join(tmpdir(), `tusche-demo-${name}.pen`);
  writeFileSync(file, JSON.stringify(without(doc, ids), null, 2));
  render(file, HOME, name, 2);
  rmSync(file);
}

// Other screens from the same evals.
const SHOTS: [string, string, string, number][] = [
  ['dashboard', 'dashboard.pen', 'ZvlpE', 1],
  ['landing', 'landing-saas.pen', 'iErvY', 1],
  ['pricing', 'pricing.pen', 'UkKk6', 1],
  ['settings', 'settings.pen', 'Fhfk3', 1],
  ['slides', 'slides.pen', 'abOyO', 1],
];
for (const [name, file, node, scale] of SHOTS) render(join(SOURCES, file), node, name, scale);
