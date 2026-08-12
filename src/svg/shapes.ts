import getStroke from 'perfect-freehand';
import type { SvgNode } from '../types';
import type { ShapeDefaults } from './svgStore';
import type { Point } from './geometry';

type NewNode = Omit<SvgNode, 'id'>;

function paint(defaults: ShapeDefaults, filled: boolean): Record<string, string> {
  const attrs: Record<string, string> = {};
  attrs.fill = filled ? defaults.fill : 'none';
  if (defaults.stroke && defaults.stroke !== 'none') {
    attrs.stroke = defaults.stroke;
    attrs['stroke-width'] = String(defaults.strokeWidth);
  } else if (!filled) {
    // An unfilled shape with no stroke would be invisible.
    attrs.stroke = defaults.fill;
    attrs['stroke-width'] = String(defaults.strokeWidth);
  }
  return attrs;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function makeRect(x: number, y: number, w: number, h: number, d: ShapeDefaults, radius = 0): NewNode {
  const attrs: Record<string, string> = {
    x: String(r3(x)),
    y: String(r3(y)),
    width: String(r3(Math.max(1, w))),
    height: String(r3(Math.max(1, h))),
    ...paint(d, true),
  };
  if (radius > 0) attrs.rx = String(r3(radius));
  return { tag: 'rect', attrs, name: 'Прямоугольник' };
}

export function makeEllipse(x: number, y: number, w: number, h: number, d: ShapeDefaults): NewNode {
  return {
    tag: 'ellipse',
    attrs: {
      cx: String(r3(x + w / 2)),
      cy: String(r3(y + h / 2)),
      rx: String(r3(Math.max(0.5, Math.abs(w) / 2))),
      ry: String(r3(Math.max(0.5, Math.abs(h) / 2))),
      ...paint(d, true),
    },
    name: 'Эллипс',
  };
}

export function makeLine(x1: number, y1: number, x2: number, y2: number, d: ShapeDefaults): NewNode {
  return {
    tag: 'line',
    attrs: {
      x1: String(r3(x1)), y1: String(r3(y1)),
      x2: String(r3(x2)), y2: String(r3(y2)),
      fill: 'none',
      stroke: d.stroke !== 'none' ? d.stroke : d.fill,
      'stroke-width': String(d.strokeWidth),
      'stroke-linecap': 'round',
    },
    name: 'Линия',
  };
}

function regularPoints(cx: number, cy: number, rx: number, ry: number, count: number, rotation = -Math.PI / 2): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const a = rotation + (i / count) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return pts;
}

export function makePolygon(x: number, y: number, w: number, h: number, d: ShapeDefaults): NewNode {
  const pts = regularPoints(x + w / 2, y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, Math.max(3, d.polygonSides));
  return {
    tag: 'polygon',
    attrs: {
      points: pts.map((p) => `${r3(p.x)},${r3(p.y)}`).join(' '),
      ...paint(d, true),
    },
    name: 'Многоугольник',
  };
}

export function makeStar(x: number, y: number, w: number, h: number, d: ShapeDefaults): NewNode {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = Math.abs(w) / 2;
  const ry = Math.abs(h) / 2;
  const points = Math.max(3, d.starPoints);
  const inner = Math.min(0.95, Math.max(0.05, d.starInner));
  const pts: Point[] = [];
  for (let i = 0; i < points * 2; i++) {
    const k = i % 2 === 0 ? 1 : inner;
    const a = -Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * rx * k, y: cy + Math.sin(a) * ry * k });
  }
  return {
    tag: 'polygon',
    attrs: {
      points: pts.map((p) => `${r3(p.x)},${r3(p.y)}`).join(' '),
      ...paint(d, true),
    },
    name: 'Звезда',
  };
}

export function makeText(x: number, y: number, content: string, d: ShapeDefaults): NewNode {
  return {
    tag: 'text',
    attrs: {
      x: String(r3(x)),
      y: String(r3(y)),
      fill: d.fill,
      'font-size': String(d.fontSize),
      'font-family': d.fontFamily,
    },
    text: content,
    name: content.slice(0, 24) || 'Текст',
  };
}

/** Cubic-smoothed outline path from perfect-freehand's stroke polygon. */
function outlineToPath(stroke: number[][]): string {
  if (stroke.length === 0) return '';
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ['M', stroke[0][0], stroke[0][1], 'Q'] as (string | number)[],
  );
  d.push('Z');
  return d
    .map((v) => (typeof v === 'number' ? r3(v) : v))
    .join(' ')
    .replace(/\s+([MQZ])\s*/g, '$1');
}

export interface FreehandOptions {
  size: number;
  thinning: number;
  smoothing: number;
  streamline: number;
}

export const DEFAULT_FREEHAND: FreehandOptions = {
  size: 6,
  thinning: 0.55,
  smoothing: 0.5,
  streamline: 0.5,
};

/** Pressure-aware pencil stroke; produces a filled outline, not a stroked line,
 *  which is what gives it the tapered look. */
export function makeFreehand(
  points: [number, number, number][],
  color: string,
  opts: FreehandOptions = DEFAULT_FREEHAND,
): NewNode | null {
  if (points.length < 2) return null;
  const stroke = getStroke(points, {
    size: opts.size,
    thinning: opts.thinning,
    smoothing: opts.smoothing,
    streamline: opts.streamline,
    simulatePressure: true,
    last: true,
  }) as number[][];
  const d = outlineToPath(stroke);
  if (!d) return null;
  return { tag: 'path', attrs: { d, fill: color, stroke: 'none' }, name: 'Штрих' };
}

export interface PenAnchor {
  point: Point;
  /** Handle leaving this anchor; mirrored to derive the incoming one. */
  handle: Point | null;
}

/** Builds a `d` string from the pen tool's anchor list. */
export function penAnchorsToPath(anchors: PenAnchor[], closed: boolean, preview?: Point): string {
  if (anchors.length === 0) return '';
  const parts: string[] = [`M${r3(anchors[0].point.x)} ${r3(anchors[0].point.y)}`];

  const segment = (from: PenAnchor, to: PenAnchor | { point: Point; handle: Point | null }) => {
    const c1 = from.handle ?? from.point;
    // The incoming handle is the mirror of the next anchor's outgoing one.
    const c2 = to.handle
      ? { x: to.point.x * 2 - to.handle.x, y: to.point.y * 2 - to.handle.y }
      : to.point;
    if (c1 === from.point && c2 === to.point) {
      parts.push(`L${r3(to.point.x)} ${r3(to.point.y)}`);
    } else {
      parts.push(
        `C${r3(c1.x)} ${r3(c1.y)} ${r3(c2.x)} ${r3(c2.y)} ${r3(to.point.x)} ${r3(to.point.y)}`,
      );
    }
  };

  for (let i = 1; i < anchors.length; i++) segment(anchors[i - 1], anchors[i]);

  if (preview && anchors.length > 0) {
    segment(anchors[anchors.length - 1], { point: preview, handle: null });
  }
  if (closed && anchors.length > 1) {
    segment(anchors[anchors.length - 1], anchors[0]);
    parts.push('Z');
  }
  return parts.join(' ');
}

export function makePath(d: string, defaults: ShapeDefaults, filled: boolean): NewNode {
  return { tag: 'path', attrs: { d, ...paint(defaults, filled) }, name: 'Контур' };
}
