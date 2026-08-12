import type { Adjustments } from '../types';

/**
 * The single source of truth for how a raster document looks. Preview and
 * export both call `applyAdjustments`, so what you see is what gets written —
 * the only difference is the resolution it runs at (and `scale`, which keeps
 * radius-based effects proportional).
 */

const REC709 = [0.2126, 0.7152, 0.0722] as const;

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

export function isNeutral(a: Adjustments): boolean {
  return (
    a.exposure === 0 && a.brightness === 0 && a.contrast === 0 && a.saturation === 0 &&
    a.vibrance === 0 && a.temperature === 0 && a.tint === 0 && a.gamma === 0 &&
    a.hue === 0 && a.sharpen === 0 && a.blur === 0 && a.opacity === 1 &&
    a.alphaFloor === 0 && !a.invert && !a.grayscale
  );
}

/**
 * Folds every per-channel scalar operation into three 256-entry lookup tables.
 * Exposure runs first (it is a light-linear gain), then white balance, then
 * the tonal controls.
 */
function buildLuts(a: Adjustments): [Uint8Array, Uint8Array, Uint8Array] {
  const expGain = Math.pow(2, a.exposure * 2);

  // Warm pushes red up / blue down; tint trades green against magenta.
  const tempGain: [number, number, number] = [
    1 + a.temperature * 0.30,
    1 + a.temperature * 0.02,
    1 - a.temperature * 0.30,
  ];
  const tintGain: [number, number, number] = [
    1 + a.tint * 0.12,
    1 - a.tint * 0.22,
    1 + a.tint * 0.12,
  ];

  const contrast = 1 + a.contrast;
  const gammaExp = Math.pow(2, -a.gamma * 2);
  const brightness = a.brightness * 0.5;

  const luts: [Uint8Array, Uint8Array, Uint8Array] = [
    new Uint8Array(256),
    new Uint8Array(256),
    new Uint8Array(256),
  ];

  for (let ch = 0; ch < 3; ch++) {
    const gain = expGain * tempGain[ch] * tintGain[ch];
    const lut = luts[ch];
    for (let i = 0; i < 256; i++) {
      let v = (i / 255) * gain;
      v += brightness;
      v = (v - 0.5) * contrast + 0.5;
      if (v < 0) v = 0;
      if (gammaExp !== 1) v = Math.pow(v, gammaExp);
      if (a.invert) v = 1 - v;
      lut[i] = clamp255(Math.round(v * 255));
    }
  }
  return luts;
}

/** Standard hue-rotation matrix (same construction as SVG feColorMatrix). */
function hueMatrix(deg: number): number[] {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const [lr, lg, lb] = REC709;
  return [
    lr + c * (1 - lr) + s * -lr,       lg + c * -lg + s * -lg,        lb + c * -lb + s * (1 - lb),
    lr + c * -lr + s * 0.143,          lg + c * (1 - lg) + s * 0.140, lb + c * -lb + s * -0.283,
    lr + c * -lr + s * -(1 - lr),      lg + c * -lg + s * lg,         lb + c * (1 - lb) + s * lb,
  ];
}

/** Premultiplied 3-pass box blur ≈ gaussian. Premultiplying stops colour from
 *  bleeding out of transparent areas and haloing cut-outs. */
function blurRGBA(data: Uint8ClampedArray, w: number, h: number, radius: number): void {
  if (radius < 0.5) return;
  const r = Math.max(1, Math.round(radius));

  // premultiply
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    data[i] = data[i] * a;
    data[i + 1] = data[i + 1] * a;
    data[i + 2] = data[i + 2] * a;
  }

  const tmp = new Float32Array(data.length);
  const win = r * 2 + 1;

  for (let pass = 0; pass < 3; pass++) {
    // horizontal
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
      for (let x = -r; x <= r; x++) {
        const xi = row + Math.min(w - 1, Math.max(0, x)) * 4;
        s0 += data[xi]; s1 += data[xi + 1]; s2 += data[xi + 2]; s3 += data[xi + 3];
      }
      for (let x = 0; x < w; x++) {
        const o = row + x * 4;
        tmp[o] = s0 / win; tmp[o + 1] = s1 / win; tmp[o + 2] = s2 / win; tmp[o + 3] = s3 / win;
        const addI = row + Math.min(w - 1, x + r + 1) * 4;
        const subI = row + Math.max(0, x - r) * 4;
        s0 += data[addI] - data[subI];
        s1 += data[addI + 1] - data[subI + 1];
        s2 += data[addI + 2] - data[subI + 2];
        s3 += data[addI + 3] - data[subI + 3];
      }
    }
    // vertical
    for (let x = 0; x < w; x++) {
      const col = x * 4;
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
      for (let y = -r; y <= r; y++) {
        const yi = Math.min(h - 1, Math.max(0, y)) * w * 4 + col;
        s0 += tmp[yi]; s1 += tmp[yi + 1]; s2 += tmp[yi + 2]; s3 += tmp[yi + 3];
      }
      for (let y = 0; y < h; y++) {
        const o = y * w * 4 + col;
        data[o] = s0 / win; data[o + 1] = s1 / win; data[o + 2] = s2 / win; data[o + 3] = s3 / win;
        const addI = Math.min(h - 1, y + r + 1) * w * 4 + col;
        const subI = Math.max(0, y - r) * w * 4 + col;
        s0 += tmp[addI] - tmp[subI];
        s1 += tmp[addI + 1] - tmp[subI + 1];
        s2 += tmp[addI + 2] - tmp[subI + 2];
        s3 += tmp[addI + 3] - tmp[subI + 3];
      }
    }
  }

  // unpremultiply
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) {
      data[i] = data[i + 1] = data[i + 2] = 0;
    } else {
      const inv = 255 / a;
      data[i] = data[i] * inv;
      data[i + 1] = data[i + 1] * inv;
      data[i + 2] = data[i + 2] * inv;
    }
  }
}

/** Unsharp mask: original + amount × (original − blurred). */
function sharpenRGBA(data: Uint8ClampedArray, w: number, h: number, amount: number, radius: number): void {
  if (amount <= 0) return;
  const blurred = new Uint8ClampedArray(data);
  blurRGBA(blurred, w, h, radius);
  const k = amount * 1.6;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp255(data[i] + k * (data[i] - blurred[i]));
    data[i + 1] = clamp255(data[i + 1] + k * (data[i + 1] - blurred[i + 1]));
    data[i + 2] = clamp255(data[i + 2] + k * (data[i + 2] - blurred[i + 2]));
  }
}

export interface ApplyOptions {
  /** Alpha mask (0..255) matching the image dimensions; 255 keeps the pixel. */
  mask?: Uint8Array | null;
  /**
   * Preview/export scale relative to the document. Radius-based effects
   * multiply by this so a blur looks identical at any preview zoom.
   */
  scale?: number;
}

/** Mutates `img` in place and returns it. */
export function applyAdjustments(
  img: ImageData,
  a: Adjustments,
  opts: ApplyOptions = {},
): ImageData {
  const { mask = null, scale = 1 } = opts;
  const data = img.data;
  const n = data.length;

  const needsLut =
    a.exposure !== 0 || a.brightness !== 0 || a.contrast !== 0 || a.gamma !== 0 ||
    a.temperature !== 0 || a.tint !== 0 || a.invert;

  if (needsLut) {
    const [lr, lg, lb] = buildLuts(a);
    for (let i = 0; i < n; i += 4) {
      if (data[i + 3] === 0) continue;
      data[i] = lr[data[i]];
      data[i + 1] = lg[data[i + 1]];
      data[i + 2] = lb[data[i + 2]];
    }
  }

  const needsColor = a.saturation !== 0 || a.vibrance !== 0 || a.hue !== 0 || a.grayscale;
  if (needsColor) {
    const m = a.hue !== 0 ? hueMatrix(a.hue) : null;
    const sat = a.saturation;
    const vib = a.vibrance;
    for (let i = 0; i < n; i += 4) {
      if (data[i + 3] === 0) continue;
      let r = data[i], g = data[i + 1], b = data[i + 2];

      if (m) {
        const nr = r * m[0] + g * m[1] + b * m[2];
        const ng = r * m[3] + g * m[4] + b * m[5];
        const nb = r * m[6] + g * m[7] + b * m[8];
        r = nr; g = ng; b = nb;
      }

      const luma = REC709[0] * r + REC709[1] * g + REC709[2] * b;

      if (a.grayscale) {
        r = g = b = luma;
      } else {
        if (vib !== 0) {
          // Boost muted pixels harder than already-saturated ones.
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          const amt = vib * (1 - (mx - mn) / 255);
          r = luma + (r - luma) * (1 + amt);
          g = luma + (g - luma) * (1 + amt);
          b = luma + (b - luma) * (1 + amt);
        }
        if (sat !== 0) {
          const k = 1 + sat;
          r = luma + (r - luma) * k;
          g = luma + (g - luma) * k;
          b = luma + (b - luma) * k;
        }
      }

      data[i] = clamp255(r);
      data[i + 1] = clamp255(g);
      data[i + 2] = clamp255(b);
    }
  }

  // Alpha: cut-out mask, then global opacity, then fringe cleanup.
  const floor = Math.round(a.alphaFloor * 255);
  if (mask || a.opacity !== 1 || floor > 0) {
    for (let i = 0, p = 0; i < n; i += 4, p++) {
      let alpha = data[i + 3];
      if (mask) alpha = (alpha * mask[p]) / 255;
      if (a.opacity !== 1) alpha *= a.opacity;
      data[i + 3] = alpha <= floor ? 0 : clamp255(alpha);
    }
  }

  if (a.blur > 0) blurRGBA(data, img.width, img.height, a.blur * 24 * scale);
  if (a.sharpen > 0) sharpenRGBA(data, img.width, img.height, a.sharpen, Math.max(1, 1.6 * scale));

  return img;
}

/** CSS-side approximation used only for the live drag of a slider — the real
 *  pixels are recomputed as soon as the drag settles. */
export function quickFilterCss(a: Adjustments): string {
  const parts: string[] = [];
  if (a.brightness !== 0 || a.exposure !== 0) {
    parts.push(`brightness(${(1 + a.brightness * 0.5) * Math.pow(2, a.exposure * 2)})`);
  }
  if (a.contrast !== 0) parts.push(`contrast(${1 + a.contrast})`);
  if (a.saturation !== 0) parts.push(`saturate(${1 + a.saturation})`);
  if (a.hue !== 0) parts.push(`hue-rotate(${a.hue}deg)`);
  if (a.grayscale) parts.push('grayscale(1)');
  if (a.invert) parts.push('invert(1)');
  if (a.blur > 0) parts.push(`blur(${a.blur * 24}px)`);
  if (a.opacity !== 1) parts.push(`opacity(${a.opacity})`);
  return parts.join(' ') || 'none';
}
