export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A selection frame: the element's *local* bounding box plus the matrix that
 * maps it into canvas space. Keeping them apart is what lets the handles hug a
 * rotated element instead of snapping to a fat axis-aligned box.
 */
export interface Frame {
  box: Rect;
  matrix: DOMMatrix;
}

// A detached SVG we use purely as a parser for transform strings — the SVG
// grammar (`rotate(30)`, unitless angles) is not what DOMMatrix accepts.
let scratchSvg: SVGSVGElement | null = null;
let scratchG: SVGGElement | null = null;

function scratch(): SVGGElement {
  if (!scratchG) {
    scratchSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    scratchG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    scratchSvg.appendChild(scratchG);
  }
  return scratchG;
}

export function parseTransform(value: string | undefined | null): DOMMatrix {
  if (!value || !value.trim()) return new DOMMatrix();
  const g = scratch();
  g.setAttribute('transform', value);
  const list = g.transform.baseVal;
  const consolidated = list.consolidate();
  const m = consolidated ? consolidated.matrix : null;
  g.removeAttribute('transform');
  if (!m) return new DOMMatrix();
  return new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]);
}

export function matrixToString(m: DOMMatrix): string {
  const r = (n: number) => {
    const v = Math.round(n * 100000) / 100000;
    return Object.is(v, -0) ? 0 : v;
  };
  if (isIdentity(m)) return '';
  // Emit the compact forms when we can — hand-edited files stay readable.
  if (m.b === 0 && m.c === 0 && m.a === 1 && m.d === 1) {
    return `translate(${r(m.e)} ${r(m.f)})`;
  }
  if (m.b === 0 && m.c === 0 && m.e === 0 && m.f === 0) {
    return `scale(${r(m.a)} ${r(m.d)})`;
  }
  return `matrix(${r(m.a)} ${r(m.b)} ${r(m.c)} ${r(m.d)} ${r(m.e)} ${r(m.f)})`;
}

export function isIdentity(m: DOMMatrix): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
}

export function transformPoint(m: DOMMatrix, x: number, y: number): Point {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

export interface Decomposed {
  translateX: number;
  translateY: number;
  rotate: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
}

/** QR-style decomposition — enough to drive rotation/scale readouts. */
export function decompose(m: DOMMatrix): Decomposed {
  const { a, b, c, d, e, f } = m;
  const scaleX = Math.hypot(a, b);
  const rotate = Math.atan2(b, a);
  const denom = scaleX || 1;
  const skew = (a * c + b * d) / (denom * denom);
  const scaleY = Math.hypot(c - a * skew, d - b * skew);
  return {
    translateX: e,
    translateY: f,
    rotate: (rotate * 180) / Math.PI,
    scaleX,
    scaleY,
    skewX: (Math.atan(skew) * 180) / Math.PI,
  };
}

/** Local bbox corners pushed through the frame matrix. */
export function frameCorners(frame: Frame): [Point, Point, Point, Point] {
  const { box, matrix } = frame;
  return [
    transformPoint(matrix, box.x, box.y),
    transformPoint(matrix, box.x + box.width, box.y),
    transformPoint(matrix, box.x + box.width, box.y + box.height),
    transformPoint(matrix, box.x, box.y + box.height),
  ];
}

export function frameBounds(frame: Frame): Rect {
  const pts = frameCorners(frame);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width < b.x || b.x + b.width < a.x ||
    a.y + a.height < b.y || b.y + b.height < a.y
  );
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function normalizeRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  };
}

// ---------------------------------------------------------------------------
// Live-DOM queries
//
// The editor renders real SVG, so the browser's own geometry engine is the most
// accurate (and by far the cheapest) way to get bounding boxes for text,
// strokes, markers and arbitrary paths.
//
// "Canvas space" throughout is the document's own user space — the coordinate
// system the `viewBox` describes — so everything the inspector shows and
// everything we write back into attributes is in the file's own units.
// `reference` is the untransformed <g> that wraps the document content.
// ---------------------------------------------------------------------------

export function findElement(root: Element | null, nodeId: string): SVGGraphicsElement | null {
  if (!root) return null;
  return root.querySelector<SVGGraphicsElement>(`[data-nid="${CSS.escape(nodeId)}"]`);
}

/** Matrix mapping an element's local coordinates into canvas space. */
export function localToCanvasMatrix(reference: SVGGraphicsElement, el: SVGGraphicsElement): DOMMatrix {
  const refCtm = reference.getScreenCTM();
  const elCtm = el.getScreenCTM();
  if (!refCtm || !elCtm) return new DOMMatrix();
  return DOMMatrix.fromMatrix(refCtm).invertSelf().multiplySelf(DOMMatrix.fromMatrix(elCtm));
}

export function frameOf(reference: SVGGraphicsElement, el: SVGGraphicsElement): Frame | null {
  let box: DOMRect;
  try {
    box = el.getBBox();
  } catch {
    return null;
  }
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return null;
  return {
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
    matrix: localToCanvasMatrix(reference, el),
  };
}

/** Axis-aligned canvas-space bounds of an element. */
export function boundsOf(reference: SVGGraphicsElement, el: SVGGraphicsElement): Rect | null {
  const frame = frameOf(reference, el);
  return frame ? frameBounds(frame) : null;
}

export function screenToCanvas(reference: SVGGraphicsElement, clientX: number, clientY: number): Point {
  const ctm = reference.getScreenCTM();
  if (!ctm) return { x: clientX, y: clientY };
  const inv = DOMMatrix.fromMatrix(ctm).invertSelf();
  return transformPoint(inv, clientX, clientY);
}

export function canvasToScreen(reference: SVGGraphicsElement, x: number, y: number): Point {
  const ctm = reference.getScreenCTM();
  if (!ctm) return { x, y };
  return transformPoint(DOMMatrix.fromMatrix(ctm), x, y);
}
