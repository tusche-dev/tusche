import { createLinter } from '@open-pencil/core/lint';
import type { SceneGraph } from '@open-pencil/scene-graph';

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
  for (const m of messages) {
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
