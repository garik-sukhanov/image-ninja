import type { SvgNode } from '../types';
import { localToCanvasMatrix, matrixToString, parseTransform, findElement } from './geometry';

/**
 * Applying a canvas-space transform to a node that lives inside groups needs
 * the parent chain taken out and put back:
 *
 *     local' = P⁻¹ · M · P · local
 *
 * where `P` maps the node's *parent* into canvas space and `M` is the gesture
 * the user just performed. We read `P` from the live DOM so nested groups,
 * `viewBox` scaling and preserveAspectRatio are all accounted for.
 */
export function applyCanvasMatrix(
  reference: SVGGraphicsElement,
  node: SvgNode,
  canvasMatrix: DOMMatrix,
): string {
  const local = parseTransform(node.attrs.transform);
  const el = findElement(reference, node.id);

  let parentMatrix = new DOMMatrix();
  const parentEl = el?.parentNode as SVGGraphicsElement | null;
  if (parentEl && typeof parentEl.getScreenCTM === 'function') {
    parentMatrix = localToCanvasMatrix(reference, parentEl);
  }

  const inverseParent = DOMMatrix.fromMatrix(parentMatrix).invertSelf();
  const next = inverseParent.multiply(canvasMatrix).multiply(parentMatrix).multiply(local);
  return matrixToString(next);
}

/** Translation in canvas units. */
export function translationMatrix(dx: number, dy: number): DOMMatrix {
  return new DOMMatrix([1, 0, 0, 1, dx, dy]);
}

/** Scale about a fixed canvas-space origin. */
export function scaleAboutMatrix(sx: number, sy: number, ox: number, oy: number): DOMMatrix {
  return new DOMMatrix()
    .translateSelf(ox, oy)
    .scaleSelf(sx, sy)
    .translateSelf(-ox, -oy);
}

/** Rotation (degrees) about a fixed canvas-space origin. */
export function rotateAboutMatrix(deg: number, ox: number, oy: number): DOMMatrix {
  return new DOMMatrix()
    .translateSelf(ox, oy)
    .rotateSelf(deg)
    .translateSelf(-ox, -oy);
}

/**
 * Bakes a node's `transform` into its geometry where that's lossless, so the
 * inspector shows real coordinates instead of a matrix. Only applied to the
 * cases where it is exact: translation of a primitive, or any matrix on a path
 * whose stroke doesn't need to keep its width.
 */
export function canFlattenTransform(node: SvgNode): boolean {
  const m = parseTransform(node.attrs.transform);
  const isTranslation = m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1;
  return isTranslation && ['rect', 'ellipse', 'circle', 'line', 'text', 'image', 'use'].includes(node.tag);
}

const TRANSLATABLE: Record<string, [string, string][]> = {
  rect: [['x', 'y']],
  image: [['x', 'y']],
  use: [['x', 'y']],
  text: [['x', 'y']],
  ellipse: [['cx', 'cy']],
  circle: [['cx', 'cy']],
  line: [['x1', 'y1'], ['x2', 'y2']],
};

export function flattenTranslation(node: SvgNode): SvgNode {
  const m = parseTransform(node.attrs.transform);
  if (m.a !== 1 || m.b !== 0 || m.c !== 0 || m.d !== 1) return node;
  const pairs = TRANSLATABLE[node.tag];
  if (!pairs) return node;

  const attrs = { ...node.attrs };
  for (const [xKey, yKey] of pairs) {
    const x = Number(attrs[xKey] ?? 0);
    const y = Number(attrs[yKey] ?? 0);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return node;
    attrs[xKey] = String(Math.round((x + m.e) * 1000) / 1000);
    attrs[yKey] = String(Math.round((y + m.f) * 1000) / 1000);
  }
  delete attrs.transform;
  return { ...node, attrs };
}
