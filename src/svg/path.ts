import { pathToCurve, parsePathString, shapeToPathArray, getPathBBox } from 'svg-path-commander/util';
import type { SvgNode } from '../types';
import type { Point } from './geometry';

/**
 * Node editing works on a *curve array* — every segment normalised to a cubic
 * after the leading `M`. That makes anchors and handles uniform no matter what
 * the file originally contained.
 *
 * The cost is that a hand-written `L` would come back as a `C`, so
 * `curvesToPathString` folds degenerate cubics (handles sitting on their
 * anchors) back into `L`. A file you only moved a node in stays readable.
 */

export type Seg = [string, ...number[]];
export type Curves = Seg[];

export interface Anchor {
  /** Index of the segment this anchor terminates. */
  index: number;
  point: Point;
  /** Control point arriving at this anchor (from the previous segment). */
  inHandle: Point | null;
  /** Control point leaving this anchor (into the next segment). */
  outHandle: Point | null;
  subpath: number;
  /** True when this anchor is the closing point of a `Z`-terminated subpath. */
  closing: boolean;
}

const EPS = 0.001;

export function toCurves(d: string): Curves {
  if (!d || !d.trim()) return [];
  try {
    return pathToCurve(d) as unknown as Curves;
  } catch {
    return [];
  }
}

function fmt(n: number): string {
  const v = Math.round(n * 1000) / 1000;
  return String(Object.is(v, -0) ? 0 : v);
}

/** Curve array → `d`, collapsing straight cubics back into line commands. */
export function curvesToPathString(curves: Curves): string {
  const out: string[] = [];
  let cx = 0;
  let cy = 0;

  for (const seg of curves) {
    const [cmd, ...args] = seg;
    if (cmd === 'M') {
      cx = args[0]; cy = args[1];
      out.push(`M${fmt(cx)} ${fmt(cy)}`);
    } else if (cmd === 'C') {
      const [c1x, c1y, c2x, c2y, x, y] = args;
      const straight =
        Math.abs(c1x - cx) < EPS && Math.abs(c1y - cy) < EPS &&
        Math.abs(c2x - x) < EPS && Math.abs(c2y - y) < EPS;
      out.push(
        straight
          ? `L${fmt(x)} ${fmt(y)}`
          : `C${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(x)} ${fmt(y)}`,
      );
      cx = x; cy = y;
    } else if (cmd === 'Z' || cmd === 'z') {
      out.push('Z');
    } else {
      out.push(cmd + args.map(fmt).join(' '));
      if (args.length >= 2) { cx = args[args.length - 2]; cy = args[args.length - 1]; }
    }
  }
  return out.join(' ');
}

export function getAnchors(curves: Curves): Anchor[] {
  const anchors: Anchor[] = [];
  let subpath = -1;
  let subpathStart = 0;

  for (let i = 0; i < curves.length; i++) {
    const seg = curves[i];
    const cmd = seg[0];
    if (cmd === 'M') {
      subpath += 1;
      subpathStart = anchors.length;
      anchors.push({
        index: i,
        point: { x: seg[1], y: seg[2] },
        inHandle: null,
        outHandle: null,
        subpath,
        closing: false,
      });
    } else if (cmd === 'C') {
      anchors.push({
        index: i,
        point: { x: seg[5], y: seg[6] },
        inHandle: { x: seg[3], y: seg[4] },
        outHandle: null,
        subpath,
        closing: false,
      });
    } else if (cmd === 'Z' || cmd === 'z') {
      const first = anchors[subpathStart];
      const last = anchors[anchors.length - 1];
      if (first && last) {
        // A `Z` after a segment that already lands on the start point means the
        // last anchor *is* the first one; flag it so the UI draws one node.
        last.closing =
          Math.abs(last.point.x - first.point.x) < EPS &&
          Math.abs(last.point.y - first.point.y) < EPS;
      }
    }
  }

  // Out-handles come from the following segment's first control point.
  for (let a = 0; a < anchors.length; a++) {
    const next = curves[anchors[a].index + 1];
    if (next && next[0] === 'C') {
      anchors[a].outHandle = { x: next[1], y: next[2] };
    }
  }
  return anchors;
}

function setSegPoint(seg: Seg, offset: number, x: number, y: number): void {
  seg[offset + 1] = x;
  seg[offset + 2] = y;
}

/** Moves an anchor and drags both of its handles along with it. */
export function moveAnchor(curves: Curves, anchorIndex: number, dx: number, dy: number): Curves {
  const next = curves.map((s) => [...s] as Seg);
  const anchors = getAnchors(curves);
  const anchor = anchors[anchorIndex];
  if (!anchor) return next;

  const seg = next[anchor.index];
  if (seg[0] === 'M') {
    setSegPoint(seg, 0, seg[1] + dx, seg[2] + dy);
  } else if (seg[0] === 'C') {
    setSegPoint(seg, 2, seg[3] + dx, seg[4] + dy); // in-handle
    setSegPoint(seg, 4, seg[5] + dx, seg[6] + dy); // anchor
  }

  const following = next[anchor.index + 1];
  if (following && following[0] === 'C') {
    setSegPoint(following, 0, following[1] + dx, following[2] + dy); // out-handle
  }

  // A closed subpath shares its first and last point — move both together.
  if (anchor.closing || anchorIndex === 0) {
    const sameSub = anchors.filter((a) => a.subpath === anchor.subpath);
    const first = sameSub[0];
    const last = sameSub[sameSub.length - 1];
    const partner = anchorIndex === 0 ? (last.closing ? last : null) : first;
    if (partner && partner.index !== anchor.index) {
      const pseg = next[partner.index];
      if (pseg[0] === 'M') setSegPoint(pseg, 0, pseg[1] + dx, pseg[2] + dy);
      else if (pseg[0] === 'C') {
        setSegPoint(pseg, 2, pseg[3] + dx, pseg[4] + dy);
        setSegPoint(pseg, 4, pseg[5] + dx, pseg[6] + dy);
      }
      const pfollow = next[partner.index + 1];
      if (pfollow && pfollow[0] === 'C') setSegPoint(pfollow, 0, pfollow[1] + dx, pfollow[2] + dy);
    }
  }

  return next;
}

/** Moves a single bezier handle; `mirror` keeps the opposite one in line. */
export function moveHandle(
  curves: Curves,
  anchorIndex: number,
  which: 'in' | 'out',
  x: number,
  y: number,
  mirror: boolean,
): Curves {
  const next = curves.map((s) => [...s] as Seg);
  const anchors = getAnchors(curves);
  const anchor = anchors[anchorIndex];
  if (!anchor) return next;

  if (which === 'in') {
    const seg = next[anchor.index];
    if (seg[0] !== 'C') return next;
    setSegPoint(seg, 2, x, y);
  } else {
    const seg = next[anchor.index + 1];
    if (!seg || seg[0] !== 'C') return next;
    setSegPoint(seg, 0, x, y);
  }

  if (mirror) {
    const px = anchor.point.x;
    const py = anchor.point.y;
    const ox = px * 2 - x;
    const oy = py * 2 - y;
    if (which === 'in') {
      const seg = next[anchor.index + 1];
      if (seg && seg[0] === 'C') setSegPoint(seg, 0, ox, oy);
    } else {
      const seg = next[anchor.index];
      if (seg && seg[0] === 'C') setSegPoint(seg, 2, ox, oy);
    }
  }

  return next;
}

/** Collapses an anchor's handles onto it, turning the joint into a corner. */
export function makeCorner(curves: Curves, anchorIndex: number): Curves {
  const next = curves.map((s) => [...s] as Seg);
  const anchors = getAnchors(curves);
  const anchor = anchors[anchorIndex];
  if (!anchor) return next;

  const seg = next[anchor.index];
  if (seg[0] === 'C') setSegPoint(seg, 2, anchor.point.x, anchor.point.y);
  const following = next[anchor.index + 1];
  if (following && following[0] === 'C') setSegPoint(following, 0, anchor.point.x, anchor.point.y);
  return next;
}

/** Gives an anchor collinear handles derived from its neighbours. */
export function makeSmooth(curves: Curves, anchorIndex: number): Curves {
  const next = curves.map((s) => [...s] as Seg);
  const anchors = getAnchors(curves);
  const anchor = anchors[anchorIndex];
  if (!anchor) return next;

  const prev = anchors[anchorIndex - 1];
  const following = anchors[anchorIndex + 1];
  if (!prev && !following) return next;

  const a = prev?.point ?? anchor.point;
  const b = following?.point ?? anchor.point;
  const tx = (b.x - a.x) / 4;
  const ty = (b.y - a.y) / 4;

  const seg = next[anchor.index];
  if (seg[0] === 'C') setSegPoint(seg, 2, anchor.point.x - tx, anchor.point.y - ty);
  const nseg = next[anchor.index + 1];
  if (nseg && nseg[0] === 'C') setSegPoint(nseg, 0, anchor.point.x + tx, anchor.point.y + ty);
  return next;
}

export function deleteAnchor(curves: Curves, anchorIndex: number): Curves {
  const anchors = getAnchors(curves);
  const anchor = anchors[anchorIndex];
  if (!anchor || anchors.length <= 2) return curves;

  const next = curves.map((s) => [...s] as Seg);

  if (next[anchor.index][0] === 'M') {
    // Removing a subpath start: promote the next segment to be the new `M`.
    const following = next[anchor.index + 1];
    if (following && following[0] === 'C') {
      next[anchor.index + 1] = ['M', following[5], following[6]];
      next.splice(anchor.index, 1);
    } else {
      next.splice(anchor.index, 1);
    }
    return next;
  }

  // Splice the segment out and let the previous one reach the next anchor.
  const removed = next[anchor.index];
  const following = next[anchor.index + 1];
  if (following && following[0] === 'C') {
    following[1] = removed[1];
    following[2] = removed[2];
  }
  next.splice(anchor.index, 1);
  return next;
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** de Casteljau split — the basis for inserting a node on a curve. */
export function splitCubic(
  p0: Point, c1: Point, c2: Point, p1: Point, t: number,
): { left: [Point, Point, Point, Point]; right: [Point, Point, Point, Point] } {
  const a = lerpPoint(p0, c1, t);
  const b = lerpPoint(c1, c2, t);
  const c = lerpPoint(c2, p1, t);
  const d = lerpPoint(a, b, t);
  const e = lerpPoint(b, c, t);
  const f = lerpPoint(d, e, t);
  return { left: [p0, a, d, f], right: [f, e, c, p1] };
}

export function cubicPointAt(p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p1.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p1.y,
  };
}

export interface HitOnPath {
  segIndex: number;
  t: number;
  point: Point;
  distance: number;
}

/** Nearest point on the path to `target` — used for click-to-insert a node. */
export function nearestOnPath(curves: Curves, target: Point): HitOnPath | null {
  let best: HitOnPath | null = null;
  let cursor: Point = { x: 0, y: 0 };

  for (let i = 0; i < curves.length; i++) {
    const seg = curves[i];
    if (seg[0] === 'M') {
      cursor = { x: seg[1], y: seg[2] };
      continue;
    }
    if (seg[0] !== 'C') continue;

    const p0 = cursor;
    const c1 = { x: seg[1], y: seg[2] };
    const c2 = { x: seg[3], y: seg[4] };
    const p1 = { x: seg[5], y: seg[6] };

    // Coarse sweep, then a short refinement around the winner.
    const SAMPLES = 24;
    let bestT = 0;
    let bestD = Infinity;
    for (let s = 0; s <= SAMPLES; s++) {
      const t = s / SAMPLES;
      const p = cubicPointAt(p0, c1, c2, p1, t);
      const d = (p.x - target.x) ** 2 + (p.y - target.y) ** 2;
      if (d < bestD) { bestD = d; bestT = t; }
    }
    let step = 1 / SAMPLES;
    for (let refine = 0; refine < 8; refine++) {
      step /= 2;
      for (const t of [bestT - step, bestT + step]) {
        if (t < 0 || t > 1) continue;
        const p = cubicPointAt(p0, c1, c2, p1, t);
        const d = (p.x - target.x) ** 2 + (p.y - target.y) ** 2;
        if (d < bestD) { bestD = d; bestT = t; }
      }
    }

    const distance = Math.sqrt(bestD);
    if (!best || distance < best.distance) {
      best = { segIndex: i, t: bestT, point: cubicPointAt(p0, c1, c2, p1, bestT), distance };
    }
    cursor = p1;
  }
  return best;
}

export function insertAnchorAt(curves: Curves, segIndex: number, t: number): Curves {
  const next = curves.map((s) => [...s] as Seg);
  const seg = next[segIndex];
  if (!seg || seg[0] !== 'C') return next;

  // Walk back for the segment's start point.
  let p0: Point = { x: 0, y: 0 };
  for (let i = segIndex - 1; i >= 0; i--) {
    const prev = next[i];
    if (prev[0] === 'M') { p0 = { x: prev[1], y: prev[2] }; break; }
    if (prev[0] === 'C') { p0 = { x: prev[5], y: prev[6] }; break; }
  }

  const { left, right } = splitCubic(
    p0,
    { x: seg[1], y: seg[2] },
    { x: seg[3], y: seg[4] },
    { x: seg[5], y: seg[6] },
    t,
  );

  const leftSeg: Seg = ['C', left[1].x, left[1].y, left[2].x, left[2].y, left[3].x, left[3].y];
  const rightSeg: Seg = ['C', right[1].x, right[1].y, right[2].x, right[2].y, right[3].x, right[3].y];
  next.splice(segIndex, 1, leftSeg, rightSeg);
  return next;
}

// ---------------------------------------------------------------------------
// Shapes → paths
// ---------------------------------------------------------------------------

const SHAPE_TAGS = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'glyph']);

export function isEditableShape(tag: string): boolean {
  return tag === 'path' || SHAPE_TAGS.has(tag);
}

/** Reads a node's geometry as a `d` string, converting primitives on the fly. */
export function nodeToPathData(node: SvgNode): string | null {
  if (node.tag === 'path') return node.attrs.d ?? '';
  if (!SHAPE_TAGS.has(node.tag)) return null;

  const attrs: Record<string, string | number> = { type: node.tag };
  for (const [k, v] of Object.entries(node.attrs)) {
    const n = Number(v);
    attrs[k] = Number.isFinite(n) && v.trim() !== '' ? n : v;
  }
  try {
    const arr = shapeToPathArray(attrs as never);
    if (!arr) return null;
    return curvesToPathString(pathToCurve(arr as never) as unknown as Curves);
  } catch {
    return null;
  }
}

/** Attributes that describe a primitive's geometry and must be dropped when
 *  it becomes a `<path>`. */
export const SHAPE_GEOMETRY_ATTRS = [
  'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r',
  'x1', 'y1', 'x2', 'y2', 'points',
];

export function pathBBox(d: string): { x: number; y: number; width: number; height: number } | null {
  try {
    const box = getPathBBox(parsePathString(d) as never);
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  } catch {
    return null;
  }
}
