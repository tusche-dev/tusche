import { createLinter } from '@open-pencil/core/lint';
import type { Color, SceneGraph } from '@open-pencil/scene-graph';
import { compositeOver, contrastRatio } from '@open-pencil/scene-graph/color';

export type LintPreset = 'recommended' | 'strict' | 'accessibility';

export interface LintOptions {
  /** Rule set of the OpenPencil linter. Default `recommended`. */
  preset?: LintPreset;
}

/** A finding of the OpenPencil linter, addressed by pen path. */
export interface SceneLintMessage {
  ruleId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** Pen path of the node (ADR-007); helper nodes of the projection report their owner. */
  path: string;
  suggest?: string;
}

/** Runs the OpenPencil linter on the subtrees of `ids` (scene node ids, that is, pen paths). */
export function lintScene(
  graph: SceneGraph,
  ids: readonly string[],
  options: LintOptions = {},
): SceneLintMessage[] {
  if (ids.length === 0) return [];
  const linter = createLinter({ preset: options.preset ?? 'recommended' });
  const { messages } = linter.lintGraph(graph, [...ids]);
  const seen = new Set<string>();
  const result: SceneLintMessage[] = [];
  for (const raw of messages) {
    const m = refine(graph, raw);
    if (m === undefined) continue;
    // Helper nodes (icon vectors, stub labels, frame strokes) carry `#` after the owner's path.
    const path = m.nodeId.split('#')[0] as string;
    const key = `${m.ruleId}\u0000${path}\u0000${m.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const message: SceneLintMessage = {
      ruleId: m.ruleId,
      severity: m.severity,
      message: m.message,
      path,
    };
    if (m.suggest !== undefined) message.suggest = m.suggest;
    result.push(message);
  }
  return result;
}

type RawMessage = ReturnType<ReturnType<typeof createLinter>['lintGraph']>['messages'][number];
type GraphNode = NonNullable<ReturnType<SceneGraph['getNode']>>;

/** Words of a layer name, as the touch-target rule reads them: `Footer links` → footer, links. */
const words = (name: string): string[] =>
  name
    .replaceAll(/([a-z\d])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z\d]+/)
    .filter(Boolean);

/** Control words of the touch-target rule that a group of controls is named after. */
const CONTROLS = new Set(['button', 'btn', 'link', 'tab', 'chip', 'tag', 'action', 'toggle']);

/** A row of controls: named in the plural (`Footer links`, `Tabs`) and holding several nodes. */
const isGroup = (node: GraphNode): boolean =>
  node.childIds.length >= 2 &&
  words(node.name).some((w) => w.endsWith('s') && CONTROLS.has(w.slice(0, -1)));

/**
 * Corrects two rules of the OpenPencil linter where they misread a design:
 * - `touch-target-size` on a row of controls (`Footer links` holding the links) — each control
 *   is a target, not the row;
 * - `color-contrast` against a semi-transparent fill — the rule takes it as opaque, so a tint
 *   over a dark card reads as 1:1. The ratio is computed again over the composited background;
 *   with no opaque fill under the tint (a component alone on the canvas) the background is
 *   unknown and the finding is dropped: its instances are checked where they stand.
 */
function refine(graph: SceneGraph, m: RawMessage): RawMessage | undefined {
  const node = graph.getNode(m.nodeId.split('#')[0] as string);
  if (!node) return m;
  if (m.ruleId === 'touch-target-size' && isGroup(node)) return undefined;
  if (m.ruleId === 'color-contrast') {
    const ratio = compositedContrast(graph, node);
    const min = (m.data as { minRatio?: number } | undefined)?.minRatio;
    if (ratio === undefined || min === undefined) return m;
    if (ratio === null || ratio >= min) return undefined;
    return { ...m, message: m.message.replace(/[\d.]+:1/, `${ratio.toFixed(2)}:1`) };
  }
  return m;
}

const solid = (n: GraphNode) => n.fills?.find((f) => f.type === 'SOLID' && f.visible && f.color);
const alphaOf = (fill: NonNullable<ReturnType<typeof solid>>) => fill.color.a * fill.opacity;
const WHITE = { r: 1, g: 1, b: 1, a: 1 };

/**
 * Contrast of a text against what is under it: semi-transparent fills of the ancestors are
 * stacked over the first opaque one. `undefined` when nothing in the stack is translucent —
 * then the rule's own ratio stands; `null` when translucent fills have no opaque one under
 * them — the background is unknown.
 */
function compositedContrast(graph: SceneGraph, text: GraphNode): number | null | undefined {
  const fg = solid(text);
  if (!fg) return undefined;
  const layers: NonNullable<ReturnType<typeof solid>>[] = [];
  for (let id = text.parentId; id; ) {
    const parent = graph.getNode(id);
    if (!parent) break;
    const fill = solid(parent);
    if (fill) {
      layers.push(fill);
      if (alphaOf(fill) >= 1) break;
    }
    id = parent.parentId;
  }
  if (alphaOf(fg) >= 1 && layers.every((f) => alphaOf(f) >= 1)) return undefined;
  if (layers.length > 0 && !layers.some((f) => alphaOf(f) >= 1)) return null;
  let bg: Color = WHITE;
  for (const fill of layers.reverse()) bg = compositeOver(fill.color, bg, alphaOf(fill));
  return contrastRatio(compositeOver(fg.color, bg, alphaOf(fg)), bg);
}
