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

type SolidFill = GraphNode['fills'][number] & { color: Color };

/** Visible solid fills in paint order: bottom to top, the last one on top. */
const solids = (n: GraphNode): SolidFill[] =>
  (n.fills ?? []).filter((f): f is SolidFill => f.type === 'SOLID' && f.visible && !!f.color);
const alphaOf = (fill: SolidFill) => fill.color.a * fill.opacity;

/**
 * Contrast of a text against what is under it: every visible solid fill of the ancestors, top
 * down, stacked over the first opaque one (which may lie under a tint on the same ancestor),
 * and every text fill stacked over that in paint order. `undefined` when no ancestor has a
 * fill — then the rule's own ratio stands; `null` when the finding should go: the text is fully
 * transparent or painted with a gradient or an image, or the background is unknown: translucent
 * fills have no opaque one under them, or a gradient or an image shows above it.
 */
function compositedContrast(graph: SceneGraph, text: GraphNode): number | null | undefined {
  // Paints under the topmost opaque solid fill are covered by it.
  const fills = text.fills ?? [];
  const base = fills.findLastIndex(
    (f) => f.type === 'SOLID' && f.visible && !!f.color && f.color.a * f.opacity >= 1,
  );
  const shown = fills.slice(Math.max(base, 0));
  // Gradients and images are not composited, so a text showing one has no single color.
  if (shown.some((f) => f.visible && f.type !== 'SOLID' && f.opacity > 0)) return null;
  const fg = solids({ ...text, fills: shown });
  if (fg.length === 0) return undefined;
  if (fg.every((f) => alphaOf(f) <= 0)) return null;
  const layers: SolidFill[] = [];
  let opaque = false;
  for (let id = text.parentId; id && !opaque; ) {
    const parent = graph.getNode(id);
    if (!parent) break;
    for (const fill of (parent.fills ?? []).toReversed()) {
      if (!fill.visible || fill.opacity <= 0) continue;
      // A gradient or an image above the opaque fill covers it and is not composited.
      if (fill.type !== 'SOLID') return null;
      if (!fill.color) continue;
      layers.push(fill as SolidFill);
      if (alphaOf(fill) >= 1) {
        opaque = true;
        break;
      }
    }
    id = parent.parentId;
  }
  if (layers.length === 0) return undefined;
  if (!opaque) return null;
  const bg = layers.reduceRight<Color>(
    (under, fill) => compositeOver(fill.color, under, alphaOf(fill)),
    { r: 1, g: 1, b: 1, a: 1 },
  );
  const color = fg.reduce<Color>(
    (under, fill) => compositeOver(fill.color, under, alphaOf(fill)),
    bg,
  );
  return contrastRatio(color, bg);
}
