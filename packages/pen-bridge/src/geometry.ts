import type { VectorNetwork, WindingRule } from '@open-pencil/scene-graph';
import { parseSVGPath } from '@open-pencil/scene-graph/parse-path';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Extremes of a cubic Bézier along one axis. */
function cubicRange(p0: number, p1: number, p2: number, p3: number): [number, number] {
  let min = Math.min(p0, p3);
  let max = Math.max(p0, p3);
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      roots.push((-b + sq) / (2 * a), (-b - sq) / (2 * a));
    }
  }
  for (const t of roots) {
    if (t <= 0 || t >= 1) continue;
    const mt = 1 - t;
    const v = mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return [min, max];
}

/** Tight bounding box of a vector network, curves included. */
export function networkBounds(network: VectorNetwork): Box | undefined {
  if (network.vertices.length === 0) return undefined;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const v of network.vertices) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  for (const s of network.segments) {
    const a = network.vertices[s.start];
    const b = network.vertices[s.end];
    if (!a || !b) continue;
    const [x0, x1] = cubicRange(a.x, a.x + s.tangentStart.x, b.x + s.tangentEnd.x, b.x);
    const [y0, y1] = cubicRange(a.y, a.y + s.tangentStart.y, b.y + s.tangentEnd.y, b.y);
    minX = Math.min(minX, x0);
    maxX = Math.max(maxX, x1);
    minY = Math.min(minY, y0);
    maxY = Math.max(maxY, y1);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Maps `from` onto `to` by scaling each axis (SVG `preserveAspectRatio="none"`). */
export function fitNetwork(network: VectorNetwork, from: Box, to: Box): VectorNetwork {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return {
    vertices: network.vertices.map((v) => ({
      ...v,
      x: (v.x - from.x) * sx + to.x,
      y: (v.y - from.y) * sy + to.y,
    })),
    segments: network.segments.map((s) => ({
      ...s,
      tangentStart: { x: s.tangentStart.x * sx, y: s.tangentStart.y * sy },
      tangentEnd: { x: s.tangentEnd.x * sx, y: s.tangentEnd.y * sy },
    })),
    regions: network.regions.map((r) => ({ ...r, loops: r.loops.map((l) => [...l]) })),
  };
}

export function pathNetwork(d: string, rule: WindingRule, filled = true): VectorNetwork {
  return parseSVGPath(d, rule, { includeOpenRegions: filled });
}
