import * as clippingNs from 'polygon-clipping';
import { cubicPointAt, toCurves, type Curves } from './path';
import { transformPoint } from './geometry';

// polygon-clipping ships named exports in its type declarations but only a
// default export in its ESM build, so resolve whichever the bundler hands us.
const clipping =
  (clippingNs as unknown as { default?: typeof clippingNs }).default ?? clippingNs;

/**
 * Boolean operations work on flattened outlines: every curve is sampled into a
 * polyline, the rings are fed to polygon-clipping, and the result comes back as
 * a polygon path. Curves do not survive the round trip — that is inherent to
 * polygon clipping and matches what most vector editors produce.
 */

type Ring = [number, number][];

function flattenCurves(curves: Curves, matrix: DOMMatrix, tolerance: number): Ring[] {
  const rings: Ring[] = [];
  let current: Ring = [];
  let cursor: { x: number; y: number } = { x: 0, y: 0 };

  const push = (x: number, y: number) => {
    const p = transformPoint(matrix, x, y);
    const last = current[current.length - 1];
    if (last && Math.abs(last[0] - p.x) < 1e-6 && Math.abs(last[1] - p.y) < 1e-6) return;
    current.push([p.x, p.y]);
  };

  for (const seg of curves) {
    if (seg[0] === 'M') {
      if (current.length > 2) rings.push(current);
      current = [];
      cursor = { x: seg[1], y: seg[2] };
      push(cursor.x, cursor.y);
    } else if (seg[0] === 'C') {
      const p0 = cursor;
      const c1 = { x: seg[1], y: seg[2] };
      const c2 = { x: seg[3], y: seg[4] };
      const p1 = { x: seg[5], y: seg[6] };
      // Control-polygon length is a cheap upper bound on the arc length.
      const rough =
        Math.hypot(c1.x - p0.x, c1.y - p0.y) +
        Math.hypot(c2.x - c1.x, c2.y - c1.y) +
        Math.hypot(p1.x - c2.x, p1.y - c2.y);
      const steps = Math.min(160, Math.max(2, Math.ceil(rough / tolerance)));
      for (let i = 1; i <= steps; i++) {
        const p = cubicPointAt(p0, c1, c2, p1, i / steps);
        push(p.x, p.y);
      }
      cursor = p1;
    }
  }
  if (current.length > 2) rings.push(current);

  // polygon-clipping wants explicitly closed rings.
  return rings.map((ring) => {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
    return ring;
  });
}

export function pathToPolygons(d: string, matrix: DOMMatrix, tolerance = 0.35): clippingNs.MultiPolygon {
  const rings = flattenCurves(toCurves(d), matrix, tolerance);
  // Each ring becomes its own polygon; the clipper resolves holes by winding.
  return rings.map((ring) => [ring]) as clippingNs.MultiPolygon;
}

function polygonsToPath(result: clippingNs.MultiPolygon): string {
  const parts: string[] = [];
  const r = (n: number) => Math.round(n * 1000) / 1000;
  for (const polygon of result) {
    for (const ring of polygon) {
      if (ring.length < 3) continue;
      parts.push(`M${r(ring[0][0])} ${r(ring[0][1])}`);
      for (let i = 1; i < ring.length; i++) parts.push(`L${r(ring[i][0])} ${r(ring[i][1])}`);
      parts.push('Z');
    }
  }
  return parts.join(' ');
}

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';

export function booleanPaths(op: BooleanOp, polygons: clippingNs.MultiPolygon[]): string | null {
  if (polygons.length < 2) return null;
  const [first, ...rest] = polygons;
  try {
    const result =
      op === 'union' ? clipping.union(first, ...rest)
      : op === 'subtract' ? clipping.difference(first, ...rest)
      : op === 'intersect' ? clipping.intersection(first, ...rest)
      : clipping.xor(first, ...rest);
    const d = polygonsToPath(result as clippingNs.MultiPolygon);
    return d || null;
  } catch {
    return null;
  }
}
