import type { Rotation } from '../types';

export interface Sized {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Orientation is defined as **flip first, then rotate clockwise** — the canvas
 * draw code and the mask transforms both follow that order, which is what
 * keeps a painted mask glued to the pixels it was painted on.
 */

export function rotateArray(m: Sized, deg: Rotation): Sized {
  if (deg === 0) return m;
  const { data, width: w, height: h } = m;
  const out = deg === 180 ? new Uint8Array(w * h) : new Uint8Array(w * h);
  const nw = deg === 180 ? w : h;
  const nh = deg === 180 ? h : w;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x];
      let nx: number, ny: number;
      if (deg === 90) { nx = h - 1 - y; ny = x; }
      else if (deg === 180) { nx = w - 1 - x; ny = h - 1 - y; }
      else { nx = y; ny = w - 1 - x; }
      out[ny * nw + nx] = v;
    }
  }
  return { data: out, width: nw, height: nh };
}

export function flipArray(m: Sized, flipH: boolean, flipV: boolean): Sized {
  if (!flipH && !flipV) return m;
  const { data, width: w, height: h } = m;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = flipV ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const sx = flipH ? w - 1 - x : x;
      out[y * w + x] = data[sy * w + sx];
    }
  }
  return { data: out, width: w, height: h };
}

function inverseRotation(deg: Rotation): Rotation {
  return deg === 90 ? 270 : deg === 270 ? 90 : deg;
}

/** Source space → oriented (on-screen) space. */
export function orientMask(m: Sized, rotate: Rotation, flipH: boolean, flipV: boolean): Sized {
  return rotateArray(flipArray(m, flipH, flipV), rotate);
}

/** Oriented space → source space; the exact inverse of `orientMask`. */
export function unorientMask(m: Sized, rotate: Rotation, flipH: boolean, flipV: boolean): Sized {
  return flipArray(rotateArray(m, inverseRotation(rotate)), flipH, flipV);
}

/** Dimensions of the image once the orientation is applied. */
export function orientedSize(width: number, height: number, rotate: Rotation): [number, number] {
  return rotate === 90 || rotate === 270 ? [height, width] : [width, height];
}

/** Draws a source bitmap into a canvas with the orientation baked in. */
export function drawOriented(
  source: CanvasImageSource,
  width: number,
  height: number,
  rotate: Rotation,
  flipH: boolean,
  flipV: boolean,
): HTMLCanvasElement {
  const [ow, oh] = orientedSize(width, height, rotate);
  const canvas = document.createElement('canvas');
  canvas.width = ow;
  canvas.height = oh;
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  // Rotate about the output centre, then flip inside the un-rotated frame so
  // the composition matches flip-then-rotate.
  ctx.translate(ow / 2, oh / 2);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(source, -width / 2, -height / 2, width, height);
  ctx.restore();
  return canvas;
}
