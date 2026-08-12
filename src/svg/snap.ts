import type { Rect } from './geometry';

export interface Guide {
  orientation: 'v' | 'h';
  /** Canvas-space coordinate of the guide line. */
  position: number;
  /** Extent of the line, so it spans both the moving and the matched object. */
  from: number;
  to: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

/** Edges and centre lines a rect can snap by. */
function xAnchors(r: Rect): number[] {
  return [r.x, r.x + r.width / 2, r.x + r.width];
}
function yAnchors(r: Rect): number[] {
  return [r.y, r.y + r.height / 2, r.y + r.height];
}

/**
 * Alignment snapping against other objects and the artboard, plus optional
 * grid snapping. Returns the *additional* delta to apply on top of the raw
 * drag, and the guides to draw.
 */
export function snapRect(
  moving: Rect,
  candidates: Rect[],
  threshold: number,
  grid: number | null,
): SnapResult {
  let bestX: { delta: number; guide: Guide } | null = null;
  let bestY: { delta: number; guide: Guide } | null = null;

  const movingX = xAnchors(moving);
  const movingY = yAnchors(moving);

  for (const target of candidates) {
    for (const tx of xAnchors(target)) {
      for (const mx of movingX) {
        const delta = tx - mx;
        if (Math.abs(delta) > threshold) continue;
        if (bestX && Math.abs(delta) >= Math.abs(bestX.delta)) continue;
        bestX = {
          delta,
          guide: {
            orientation: 'v',
            position: tx,
            from: Math.min(moving.y, target.y),
            to: Math.max(moving.y + moving.height, target.y + target.height),
          },
        };
      }
    }
    for (const ty of yAnchors(target)) {
      for (const my of movingY) {
        const delta = ty - my;
        if (Math.abs(delta) > threshold) continue;
        if (bestY && Math.abs(delta) >= Math.abs(bestY.delta)) continue;
        bestY = {
          delta,
          guide: {
            orientation: 'h',
            position: ty,
            from: Math.min(moving.x, target.x),
            to: Math.max(moving.x + moving.width, target.x + target.width),
          },
        };
      }
    }
  }

  let dx = bestX?.delta ?? 0;
  let dy = bestY?.delta ?? 0;
  const guides: Guide[] = [];
  if (bestX) guides.push(bestX.guide);
  if (bestY) guides.push(bestY.guide);

  // Grid only kicks in where object snapping found nothing, so alignment to
  // real content always wins over alignment to an invisible lattice.
  if (grid && grid > 0) {
    if (!bestX) dx = Math.round(moving.x / grid) * grid - moving.x;
    if (!bestY) dy = Math.round(moving.y / grid) * grid - moving.y;
  }

  return { dx, dy, guides };
}

/** Snaps a single point (node editing, pen tool). */
export function snapPoint(
  x: number,
  y: number,
  candidates: Rect[],
  threshold: number,
  grid: number | null,
): { x: number; y: number; guides: Guide[] } {
  const result = snapRect({ x, y, width: 0, height: 0 }, candidates, threshold, grid);
  return { x: x + result.dx, y: y + result.dy, guides: result.guides };
}
