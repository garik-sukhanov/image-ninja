import { create } from 'zustand';
import {
  DEFAULT_EXPORT,
  NEUTRAL_ADJUSTMENTS,
  type Adjustments,
  type CropRect,
  type ExportSettings,
  type RasterDocument,
  type RasterSource,
  type Rotation,
} from '../types';
import { drawOriented, orientMask, orientedSize, unorientMask } from './orient';

export type RasterTool = 'move' | 'crop' | 'wand' | 'eraser' | 'restore' | 'picker';

interface HistoryEntry {
  mask: Uint8Array | null;
  crop: CropRect | null;
  rotate: Rotation;
  flipH: boolean;
  flipV: boolean;
  adjustments: Adjustments;
}

const HISTORY_LIMIT = 24;

interface RasterState {
  source: RasterSource | null;
  /** Decoded original, before orientation. */
  bitmap: ImageBitmap | null;
  /** Source with rotate/flip baked in — everything else works in this space. */
  oriented: HTMLCanvasElement | null;
  /** Cached RGBA of `oriented`, used by the wand and the AI segmenter. */
  orientedPixels: ImageData | null;

  crop: CropRect | null;
  rotate: Rotation;
  flipH: boolean;
  flipV: boolean;
  adjustments: Adjustments;

  /** One byte per pixel of the oriented image; 255 = fully visible. */
  mask: Uint8Array | null;
  /** Bumped on every mask mutation so the canvas knows to repaint. */
  maskRevision: number;
  /** Bumped when the underlying pixels change (load, rotate, flip). */
  pixelRevision: number;

  tool: RasterTool;
  brushSize: number;
  brushHardness: number;
  brushStrength: number;
  wandTolerance: number;
  wandContiguous: boolean;
  wandFeather: number;
  wandExpand: number;
  /** Segmentation model id, see electron/ipc/segment.ts. */
  modelId: string;
  busy: string | null;

  zoom: number;
  panX: number;
  panY: number;
  /** Live crop draft while the crop tool is active. */
  cropDraft: CropRect | null;
  cropAspect: number | null;
  showMaskOverlay: boolean;

  past: HistoryEntry[];
  future: HistoryEntry[];

  loadDocument: (doc: RasterDocument, bitmap: ImageBitmap, mask: Uint8Array | null) => void;
  reset: () => void;

  setAdjustment: <K extends keyof Adjustments>(key: K, value: Adjustments[K]) => void;
  resetAdjustments: () => void;
  setRotate: (rotate: Rotation) => void;
  rotateBy: (delta: 90 | -90) => void;
  setFlip: (h: boolean, v: boolean) => void;
  setCrop: (crop: CropRect | null) => void;
  setCropDraft: (crop: CropRect | null) => void;
  setCropAspect: (aspect: number | null) => void;
  applyCropDraft: () => void;

  setTool: (tool: RasterTool) => void;
  setBrush: (patch: Partial<Pick<RasterState, 'brushSize' | 'brushHardness' | 'brushStrength'>>) => void;
  setWand: (patch: Partial<Pick<RasterState, 'wandTolerance' | 'wandContiguous' | 'wandFeather' | 'wandExpand'>>) => void;
  setModelId: (id: string) => void;
  setBusy: (label: string | null) => void;
  setShowMaskOverlay: (show: boolean) => void;

  ensureMask: () => Uint8Array;
  setMask: (mask: Uint8Array | null) => void;
  clearMask: () => void;
  invertMask: () => void;
  touchMask: () => void;

  setView: (zoom: number, panX: number, panY: number) => void;
  setZoom: (zoom: number) => void;

  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  exportSettings: ExportSettings;
  setExportSettings: (patch: Partial<ExportSettings>) => void;
}

function snapshot(s: RasterState): HistoryEntry {
  return {
    mask: s.mask ? new Uint8Array(s.mask) : null,
    crop: s.crop,
    rotate: s.rotate,
    flipH: s.flipH,
    flipV: s.flipV,
    adjustments: s.adjustments,
  };
}

/** Re-derives the oriented canvas + its pixel cache after an orientation change. */
function rebuildOriented(bitmap: ImageBitmap | null, rotate: Rotation, flipH: boolean, flipV: boolean) {
  if (!bitmap) return { oriented: null, orientedPixels: null };
  const canvas = drawOriented(bitmap, bitmap.width, bitmap.height, rotate, flipH, flipV);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { oriented: canvas, orientedPixels: pixels };
}

export const useRasterStore = create<RasterState>((set, get) => ({
  source: null,
  bitmap: null,
  oriented: null,
  orientedPixels: null,

  crop: null,
  rotate: 0,
  flipH: false,
  flipV: false,
  adjustments: { ...NEUTRAL_ADJUSTMENTS },

  mask: null,
  maskRevision: 0,
  pixelRevision: 0,

  tool: 'move',
  brushSize: 48,
  brushHardness: 0.7,
  brushStrength: 1,
  wandTolerance: 32,
  wandContiguous: true,
  wandFeather: 1,
  wandExpand: 0,
  modelId: 'u2net',
  busy: null,

  zoom: 1,
  panX: 0,
  panY: 0,
  cropDraft: null,
  cropAspect: null,
  showMaskOverlay: false,

  past: [],
  future: [],

  exportSettings: { ...DEFAULT_EXPORT },

  loadDocument: (doc, bitmap, mask) => {
    const built = rebuildOriented(bitmap, doc.rotate, doc.flipH, doc.flipV);
    set((s) => ({
      source: doc.source,
      bitmap,
      ...built,
      crop: doc.crop,
      rotate: doc.rotate,
      flipH: doc.flipH,
      flipV: doc.flipV,
      adjustments: { ...NEUTRAL_ADJUSTMENTS, ...doc.adjustments },
      exportSettings: { ...DEFAULT_EXPORT, ...doc.exportSettings },
      mask,
      maskRevision: s.maskRevision + 1,
      pixelRevision: s.pixelRevision + 1,
      zoom: doc.ui.zoom || 1,
      panX: doc.ui.panX,
      panY: doc.ui.panY,
      past: [],
      future: [],
      cropDraft: null,
      tool: 'move',
    }));
  },

  reset: () =>
    set({
      source: null, bitmap: null, oriented: null, orientedPixels: null,
      crop: null, rotate: 0, flipH: false, flipV: false,
      adjustments: { ...NEUTRAL_ADJUSTMENTS }, mask: null,
      past: [], future: [], cropDraft: null, busy: null,
    }),

  setAdjustment: (key, value) => {
    get().pushHistory();
    set((s) => ({ adjustments: { ...s.adjustments, [key]: value } }));
  },

  resetAdjustments: () => {
    get().pushHistory();
    set({ adjustments: { ...NEUTRAL_ADJUSTMENTS } });
  },

  setRotate: (rotate) => {
    const s = get();
    if (s.rotate === rotate) return;
    get().pushHistory();
    // Move the mask through source space so it stays glued to the pixels.
    let mask = s.mask;
    if (mask && s.oriented) {
      const src = unorientMask(
        { data: mask, width: s.oriented.width, height: s.oriented.height },
        s.rotate, s.flipH, s.flipV,
      );
      mask = orientMask(src, rotate, s.flipH, s.flipV).data;
    }
    const built = rebuildOriented(s.bitmap, rotate, s.flipH, s.flipV);
    set((st) => ({
      rotate, mask, ...built,
      crop: null,
      cropDraft: null,
      maskRevision: st.maskRevision + 1,
      pixelRevision: st.pixelRevision + 1,
    }));
  },

  rotateBy: (delta) => {
    const next = (((get().rotate + delta) % 360) + 360) % 360;
    get().setRotate(next as Rotation);
  },

  setFlip: (flipH, flipV) => {
    const s = get();
    if (s.flipH === flipH && s.flipV === flipV) return;
    get().pushHistory();
    let mask = s.mask;
    if (mask && s.oriented) {
      const src = unorientMask(
        { data: mask, width: s.oriented.width, height: s.oriented.height },
        s.rotate, s.flipH, s.flipV,
      );
      mask = orientMask(src, s.rotate, flipH, flipV).data;
    }
    const built = rebuildOriented(s.bitmap, s.rotate, flipH, flipV);
    set((st) => ({
      flipH, flipV, mask, ...built,
      maskRevision: st.maskRevision + 1,
      pixelRevision: st.pixelRevision + 1,
    }));
  },

  setCrop: (crop) => {
    get().pushHistory();
    set({ crop });
  },
  setCropDraft: (cropDraft) => set({ cropDraft }),
  setCropAspect: (cropAspect) => set({ cropAspect }),
  applyCropDraft: () => {
    const draft = get().cropDraft;
    if (!draft || draft.width < 1 || draft.height < 1) return;
    get().pushHistory();
    set({ crop: draft, cropDraft: null, tool: 'move' });
  },

  setTool: (tool) => set((s) => ({ tool, cropDraft: tool === 'crop' ? s.cropDraft : null })),
  setBrush: (patch) => set(patch as Partial<RasterState>),
  setWand: (patch) => set(patch as Partial<RasterState>),
  setModelId: (modelId) => set({ modelId }),
  setBusy: (busy) => set({ busy }),
  setShowMaskOverlay: (showMaskOverlay) => set({ showMaskOverlay }),

  ensureMask: () => {
    const s = get();
    if (s.mask) return s.mask;
    const w = s.oriented?.width ?? 0;
    const h = s.oriented?.height ?? 0;
    const mask = new Uint8Array(w * h).fill(255);
    set((st) => ({ mask, maskRevision: st.maskRevision + 1 }));
    return mask;
  },

  setMask: (mask) => set((s) => ({ mask, maskRevision: s.maskRevision + 1 })),
  clearMask: () => {
    get().pushHistory();
    set((s) => ({ mask: null, maskRevision: s.maskRevision + 1 }));
  },
  invertMask: () => {
    const s = get();
    if (!s.oriented) return;
    get().pushHistory();
    const size = s.oriented.width * s.oriented.height;
    const next = new Uint8Array(size);
    if (s.mask) {
      for (let i = 0; i < size; i++) next[i] = 255 - s.mask[i];
    }
    set((st) => ({ mask: next, maskRevision: st.maskRevision + 1 }));
  },
  touchMask: () => set((s) => ({ maskRevision: s.maskRevision + 1 })),

  setView: (zoom, panX, panY) => set({ zoom, panX, panY }),
  setZoom: (zoom) => set({ zoom: Math.min(32, Math.max(0.02, zoom)) }),

  pushHistory: () => {
    const s = get();
    const past = [...s.past, snapshot(s)];
    if (past.length > HISTORY_LIMIT) past.shift();
    set({ past, future: [] });
  },

  undo: () => {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev) return;
    const orientationChanged = prev.rotate !== s.rotate || prev.flipH !== s.flipH || prev.flipV !== s.flipV;
    const built = orientationChanged
      ? rebuildOriented(s.bitmap, prev.rotate, prev.flipH, prev.flipV)
      : { oriented: s.oriented, orientedPixels: s.orientedPixels };
    set({
      past: s.past.slice(0, -1),
      future: [...s.future, snapshot(s)],
      mask: prev.mask,
      crop: prev.crop,
      rotate: prev.rotate,
      flipH: prev.flipH,
      flipV: prev.flipV,
      adjustments: prev.adjustments,
      ...built,
      maskRevision: s.maskRevision + 1,
      pixelRevision: s.pixelRevision + 1,
    });
  },

  redo: () => {
    const s = get();
    const next = s.future[s.future.length - 1];
    if (!next) return;
    const orientationChanged = next.rotate !== s.rotate || next.flipH !== s.flipH || next.flipV !== s.flipV;
    const built = orientationChanged
      ? rebuildOriented(s.bitmap, next.rotate, next.flipH, next.flipV)
      : { oriented: s.oriented, orientedPixels: s.orientedPixels };
    set({
      future: s.future.slice(0, -1),
      past: [...s.past, snapshot(s)],
      mask: next.mask,
      crop: next.crop,
      rotate: next.rotate,
      flipH: next.flipH,
      flipV: next.flipV,
      adjustments: next.adjustments,
      ...built,
      maskRevision: s.maskRevision + 1,
      pixelRevision: s.pixelRevision + 1,
    });
  },

  setExportSettings: (patch) =>
    set((s) => ({ exportSettings: { ...s.exportSettings, ...patch } })),
}));

/** Size of the working (oriented, cropped) image in document pixels. */
export function documentSize(): { width: number; height: number } {
  const s = useRasterStore.getState();
  if (s.crop) return { width: Math.round(s.crop.width), height: Math.round(s.crop.height) };
  if (s.oriented) return { width: s.oriented.width, height: s.oriented.height };
  if (s.source) {
    const [w, h] = orientedSize(s.source.width, s.source.height, s.rotate);
    return { width: w, height: h };
  }
  return { width: 0, height: 0 };
}
