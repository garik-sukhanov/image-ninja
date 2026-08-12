/**
 * A GPU-friendly mirror of the alpha mask.
 *
 * The mask itself is a plain `Uint8Array` because that's what the wand, the
 * brush and the segmenter all want to touch. Compositing, though, wants a
 * canvas so the browser can scale and clip it for free — so we keep a canvas
 * whose *alpha* channel mirrors the array, and refresh only the rectangle a
 * brush dab actually touched.
 */

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let sourceRef: Uint8Array | null = null;

export interface DirtyRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function ensure(width: number, height: number): CanvasRenderingContext2D {
  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    sourceRef = null;
  }
  return ctx!;
}

/** Full rebuild — call after the wand, the segmenter or an undo. */
export function syncMaskCanvas(mask: Uint8Array, width: number, height: number): HTMLCanvasElement {
  const c = ensure(width, height);
  const img = c.createImageData(width, height);
  const d = img.data;
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    d[i] = 255;
    d[i + 1] = 255;
    d[i + 2] = 255;
    d[i + 3] = mask[p];
  }
  c.putImageData(img, 0, 0);
  sourceRef = mask;
  return canvas!;
}

/** Partial refresh used while a brush stroke is in flight. */
export function syncMaskRect(
  mask: Uint8Array,
  width: number,
  height: number,
  rect: DirtyRect,
): HTMLCanvasElement {
  if (!canvas || canvas.width !== width || canvas.height !== height || sourceRef !== mask) {
    return syncMaskCanvas(mask, width, height);
  }
  const c = ctx!;
  const w = rect.maxX - rect.minX + 1;
  const h = rect.maxY - rect.minY + 1;
  if (w <= 0 || h <= 0) return canvas;

  const img = c.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const srcRow = (rect.minY + y) * width + rect.minX;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = mask[srcRow + x];
    }
  }
  c.putImageData(img, rect.minX, rect.minY);
  return canvas;
}

export function getMaskCanvas(): HTMLCanvasElement | null {
  return canvas;
}

export function dropMaskCanvas(): void {
  canvas = null;
  ctx = null;
  sourceRef = null;
}
