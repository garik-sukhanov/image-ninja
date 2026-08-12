import * as MagicWand from 'magic-wand-tool';

/**
 * A selection is one byte per pixel, 0..255 (soft edges after feathering).
 * The alpha mask the document carries has the same shape, so applying a
 * selection is a per-pixel blend rather than a hard stamp.
 */
export type Selection = Uint8Array;

export interface WandOptions {
  tolerance: number;
  /** false selects every similar pixel in the image, not just the blob under the cursor. */
  contiguous: boolean;
  /** Soften the selection edge by this many pixels. */
  feather: number;
  /** Grow (+) or shrink (−) the selection before feathering. */
  expand: number;
  /** Also match on alpha, so clicking transparent pixels behaves sensibly. */
  sampleAlpha?: boolean;
}

/** Flood fill from a seed pixel via magic-wand-tool's scan-line implementation. */
function contiguousSelect(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  tolerance: number,
): Selection {
  const result = MagicWand.floodFill(
    { data: rgba, width, height, bytes: 4 },
    x,
    y,
    tolerance,
    null,
    true,
  );
  const out = new Uint8Array(width * height);
  if (!result) return out;
  for (let i = 0; i < out.length; i++) out[i] = result.data[i] ? 255 : 0;
  return out;
}

/** Whole-image match against the seed colour — the "select similar" mode. */
function globalSelect(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  tolerance: number,
  sampleAlpha: boolean,
): Selection {
  const seed = (y * width + x) * 4;
  const sr = rgba[seed], sg = rgba[seed + 1], sb = rgba[seed + 2], sa = rgba[seed + 3];
  const out = new Uint8Array(width * height);
  // Compare squared distance so the tolerance slider feels like the wand's.
  const limit = tolerance * tolerance * 3;

  for (let p = 0, i = 0; p < out.length; p++, i += 4) {
    const dr = rgba[i] - sr;
    const dg = rgba[i + 1] - sg;
    const db = rgba[i + 2] - sb;
    let dist = dr * dr + dg * dg + db * db;
    if (sampleAlpha) {
      const da = rgba[i + 3] - sa;
      dist += da * da;
    }
    out[p] = dist <= limit ? 255 : 0;
  }
  return out;
}

/** Morphological dilate/erode on a binary selection (chebyshev distance). */
function expandSelection(sel: Selection, width: number, height: number, amount: number): Selection {
  const r = Math.abs(Math.round(amount));
  if (r === 0) return sel;
  const grow = amount > 0;
  let cur = sel;

  for (let step = 0; step < r; step++) {
    const next = new Uint8Array(cur.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        let hit = grow ? cur[p] > 127 : true;
        for (let dy = -1; dy <= 1 && (grow ? !hit : hit); dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) { if (!grow) hit = false; continue; }
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) { if (!grow) hit = false; continue; }
            const v = cur[ny * width + nx] > 127;
            if (grow && v) { hit = true; break; }
            if (!grow && !v) { hit = false; break; }
          }
        }
        next[p] = hit ? 255 : 0;
      }
    }
    cur = next;
  }
  return cur;
}

/** Separable box blur — soft selection edges without a visible stair-step. */
export function featherSelection(sel: Selection, width: number, height: number, radius: number): Selection {
  const r = Math.round(radius);
  if (r <= 0) return sel;
  const win = r * 2 + 1;
  const tmp = new Float32Array(sel.length);
  const out = new Uint8Array(sel.length);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += sel[row + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / win;
      sum += sel[row + Math.min(width - 1, x + r + 1)] - sel[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = Math.round(sum / win);
      sum += tmp[Math.min(height - 1, y + r + 1) * width + x] - tmp[Math.max(0, y - r) * width + x];
    }
  }
  return out;
}

export function magicWand(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  opts: WandOptions,
): Selection {
  const cx = Math.min(width - 1, Math.max(0, Math.round(x)));
  const cy = Math.min(height - 1, Math.max(0, Math.round(y)));

  let sel = opts.contiguous
    ? contiguousSelect(rgba, width, height, cx, cy, opts.tolerance)
    : globalSelect(rgba, width, height, cx, cy, opts.tolerance, opts.sampleAlpha ?? true);

  if (opts.expand !== 0) sel = expandSelection(sel, width, height, opts.expand);
  if (opts.feather > 0) sel = featherSelection(sel, width, height, opts.feather);
  return sel;
}

/** Cuts a selection out of (or back into) the document's alpha mask. */
export function applySelection(mask: Uint8Array, sel: Selection, mode: 'erase' | 'restore'): void {
  if (mode === 'erase') {
    for (let i = 0; i < mask.length; i++) {
      const keep = 255 - sel[i];
      if (keep < mask[i]) mask[i] = keep;
    }
  } else {
    for (let i = 0; i < mask.length; i++) {
      if (sel[i] > mask[i]) mask[i] = sel[i];
    }
  }
}

/**
 * Paints a soft round brush into the mask.
 * `strength` 0..1 scales how much a single dab moves the mask value.
 */
export function paintBrush(
  mask: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  hardness: number,
  strength: number,
  mode: 'erase' | 'restore',
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const r = Math.max(0.5, radius);
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(height - 1, Math.ceil(cy + r));
  if (x1 < x0 || y1 < y0) return null;

  // hardness 1 → a crisp disc, hardness 0 → falloff across the whole radius
  const inner = r * Math.min(0.99, hardness);
  const falloff = Math.max(0.0001, r - inner);

  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > r) continue;
      const t = dist <= inner ? 1 : 1 - (dist - inner) / falloff;
      const amount = t * t * (3 - 2 * t) * strength; // smoothstep
      const p = y * width + x;
      if (mode === 'erase') {
        const target = Math.round(mask[p] * (1 - amount));
        if (target < mask[p]) mask[p] = target;
      } else {
        const target = Math.round(mask[p] + (255 - mask[p]) * amount);
        if (target > mask[p]) mask[p] = target;
      }
    }
  }
  return { minX: x0, minY: y0, maxX: x1, maxY: y1 };
}
