import { applyAdjustments, isNeutral } from './pipeline';
import { getMaskCanvas, syncMaskCanvas } from './maskCanvas';
import { useRasterStore } from './rasterStore';
import type { CropRect } from '../types';

export interface ComposeOptions {
  /** Output scale relative to the document size. */
  scale?: number;
  /** Clamp the long edge — used to keep interactive previews fast. */
  maxSize?: number;
  /** Flatten transparency onto this colour before returning. */
  background?: string | null;
  /** Skip the pixel pipeline (raw crop only) — used by the AI segmenter. */
  skipAdjustments?: boolean;
  /** Render the whole image regardless of the crop — the crop tool's preview. */
  ignoreCrop?: boolean;
  /**
   * Drop blur/sharpen for this pass. Used only while a brush stroke is in
   * flight, where those two dominate the frame budget and the user is looking
   * at the mask edge rather than the softening.
   */
  skipExpensive?: boolean;
}

export interface ComposeResult {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Effective scale actually used, after the `maxSize` clamp. */
  scale: number;
}

function effectiveCrop(oriented: HTMLCanvasElement, crop: CropRect | null): CropRect {
  if (!crop) return { x: 0, y: 0, width: oriented.width, height: oriented.height };
  const x = Math.max(0, Math.min(oriented.width - 1, Math.round(crop.x)));
  const y = Math.max(0, Math.min(oriented.height - 1, Math.round(crop.y)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(oriented.width - x, Math.round(crop.width))),
    height: Math.max(1, Math.min(oriented.height - y, Math.round(crop.height))),
  };
}

/**
 * Renders the document exactly as it will be exported.
 *
 * The mask is applied by the compositor (`destination-in` against the mask
 * canvas) so the browser handles scaling and clipping, and the colour pipeline
 * then runs only over the output resolution — that is what keeps a 24 MP photo
 * interactive while a brush is dragging.
 */
export function composeDocument(opts: ComposeOptions = {}): ComposeResult | null {
  const s = useRasterStore.getState();
  if (!s.oriented) return null;

  const crop = effectiveCrop(s.oriented, opts.ignoreCrop ? null : s.crop);
  let scale = opts.scale ?? 1;
  if (opts.maxSize) {
    const longest = Math.max(crop.width, crop.height) * scale;
    if (longest > opts.maxSize) scale *= opts.maxSize / longest;
  }

  const width = Math.max(1, Math.round(crop.width * scale));
  const height = Math.max(1, Math.round(crop.height * scale));

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(s.oriented, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);

  if (s.mask) {
    let maskCanvas = getMaskCanvas();
    if (!maskCanvas || maskCanvas.width !== s.oriented.width || maskCanvas.height !== s.oriented.height) {
      maskCanvas = syncMaskCanvas(s.mask, s.oriented.width, s.oriented.height);
    }
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(maskCanvas, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
    ctx.restore();
  }

  if (!opts.skipAdjustments && !isNeutral(s.adjustments)) {
    const adjustments = opts.skipExpensive
      ? { ...s.adjustments, blur: 0, sharpen: 0 }
      : s.adjustments;
    if (!isNeutral(adjustments)) {
      const img = ctx.getImageData(0, 0, width, height);
      applyAdjustments(img, adjustments, { scale });
      ctx.putImageData(img, 0, 0);
    }
  }

  if (opts.background) {
    const flat = document.createElement('canvas');
    flat.width = width;
    flat.height = height;
    const fctx = flat.getContext('2d')!;
    fctx.fillStyle = opts.background;
    fctx.fillRect(0, 0, width, height);
    fctx.drawImage(out, 0, 0);
    return { canvas: flat, width, height, scale };
  }

  return { canvas: out, width, height, scale };
}

/** RGBA bytes of the composed document — what gets handed to sharp. */
export function composeToRgba(opts: ComposeOptions = {}): { pixels: Uint8Array; width: number; height: number } | null {
  const result = composeDocument(opts);
  if (!result) return null;
  const ctx = result.canvas.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, result.width, result.height);
  return { pixels: new Uint8Array(img.data.buffer.slice(0)), width: result.width, height: result.height };
}

/** Small data URL for the project card. */
export function composePoster(maxSize = 320): string | null {
  const result = composeDocument({ maxSize });
  if (!result) return null;
  // Cards sit on a dark surface, so bake in a matte rather than showing
  // browser-default black behind transparent pixels.
  const flat = document.createElement('canvas');
  flat.width = result.width;
  flat.height = result.height;
  const ctx = flat.getContext('2d')!;
  ctx.fillStyle = '#26272f';
  ctx.fillRect(0, 0, result.width, result.height);
  ctx.drawImage(result.canvas, 0, 0);
  return flat.toDataURL('image/jpeg', 0.72);
}
