import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRasterStore } from '../../raster/rasterStore';
import { composeDocument } from '../../raster/compose';
import { applySelection, magicWand, paintBrush } from '../../raster/selection';
import { syncMaskCanvas, syncMaskRect } from '../../raster/maskCanvas';
import type { CropRect } from '../../types';

type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | null;

const HANDLE_HIT = 10;

export function RasterCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const oriented = useRasterStore((s) => s.oriented);
  const pixelRevision = useRasterStore((s) => s.pixelRevision);
  const maskRevision = useRasterStore((s) => s.maskRevision);
  const adjustments = useRasterStore((s) => s.adjustments);
  const crop = useRasterStore((s) => s.crop);
  const cropDraft = useRasterStore((s) => s.cropDraft);
  const cropAspect = useRasterStore((s) => s.cropAspect);
  const tool = useRasterStore((s) => s.tool);
  const zoom = useRasterStore((s) => s.zoom);
  const panX = useRasterStore((s) => s.panX);
  const panY = useRasterStore((s) => s.panY);
  const brushSize = useRasterStore((s) => s.brushSize);
  const showMaskOverlay = useRasterStore((s) => s.showMaskOverlay);

  const cropMode = tool === 'crop';
  const docW = oriented?.width ?? 0;
  const docH = oriented?.height ?? 0;

  // The image rectangle shown on screen: full frame in crop mode, cropped
  // result otherwise.
  const shown: CropRect =
    cropMode || !crop
      ? { x: 0, y: 0, width: docW, height: docH }
      : crop;

  // -------------------------------------------------------------------------
  // Coordinate mapping
  // -------------------------------------------------------------------------

  const docToScreen = useCallback(
    (x: number, y: number) => ({
      x: size.w / 2 + panX + (x - shown.x - shown.width / 2) * zoom,
      y: size.h / 2 + panY + (y - shown.y - shown.height / 2) * zoom,
    }),
    [size.w, size.h, panX, panY, zoom, shown.x, shown.y, shown.width, shown.height],
  );

  const screenToDoc = useCallback(
    (x: number, y: number) => ({
      x: (x - size.w / 2 - panX) / zoom + shown.x + shown.width / 2,
      y: (y - size.h / 2 - panY) / zoom + shown.y + shown.height / 2,
    }),
    [size.w, size.h, panX, panY, zoom, shown.x, shown.y, shown.width, shown.height],
  );

  const localPoint = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  // -------------------------------------------------------------------------
  // Sizing + fit
  // -------------------------------------------------------------------------

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  const fitToView = useCallback(() => {
    if (!size.w || !size.h || !docW) return;
    const w = crop && !cropMode ? crop.width : docW;
    const h = crop && !cropMode ? crop.height : docH;
    const next = Math.min((size.w - 64) / w, (size.h - 64) / h);
    useRasterStore.getState().setView(Math.min(1, Math.max(0.02, next)), 0, 0);
  }, [size.w, size.h, docW, docH, crop, cropMode]);

  // Fit once when a new image arrives.
  const fittedFor = useRef<number>(-1);
  useEffect(() => {
    if (!docW || !size.w) return;
    if (fittedFor.current === pixelRevision) return;
    fittedFor.current = pixelRevision;
    fitToView();
  }, [docW, size.w, pixelRevision, fitToView]);

  // -------------------------------------------------------------------------
  // Compose the preview bitmap
  // -------------------------------------------------------------------------

  const [previewVersion, setPreviewVersion] = useState(0);
  const strokeActive = useRef(false);

  const recompose = useCallback(
    (fast = false) => {
      if (!useRasterStore.getState().oriented) {
        previewRef.current = null;
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const result = composeDocument({
        // Compose at native resolution at most; the display canvas handles
        // magnification so zooming in stays crisp without recomposing.
        scale: Math.min(1, useRasterStore.getState().zoom * dpr),
        maxSize: 4096,
        ignoreCrop: useRasterStore.getState().tool === 'crop',
        skipExpensive: fast,
      });
      previewRef.current = result?.canvas ?? null;
      setPreviewVersion((v) => v + 1);
    },
    [],
  );

  useEffect(() => {
    if (strokeActive.current) return;
    recompose();
  }, [recompose, pixelRevision, maskRevision, adjustments, crop, cropMode, zoom]);

  // -------------------------------------------------------------------------
  // Paint
  // -------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const preview = previewRef.current;
    if (!preview || !docW) return;

    const topLeft = docToScreen(shown.x, shown.y);
    const drawW = shown.width * zoom;
    const drawH = shown.height * zoom;

    // Checkerboard so transparency reads as transparency, not as black.
    drawCheckerboard(ctx, topLeft.x, topLeft.y, drawW, drawH);

    ctx.imageSmoothingEnabled = zoom < 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(preview, topLeft.x, topLeft.y, drawW, drawH);

    if (showMaskOverlay) drawMaskOverlay(ctx, topLeft.x, topLeft.y, drawW, drawH);

    if (cropMode) {
      const rect = cropDraft ?? crop ?? { x: 0, y: 0, width: docW, height: docH };
      drawCropOverlay(ctx, rect, docToScreen, size);
    }

    if (cursor && (tool === 'eraser' || tool === 'restore')) {
      const r = (brushSize / 2) * zoom;
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, Math.max(2, r), 0, Math.PI * 2);
      ctx.strokeStyle = tool === 'eraser' ? 'rgba(255,120,90,0.95)' : 'rgba(0,214,164,0.95)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 0.75;
      ctx.stroke();
    }
  }, [
    size, previewVersion, zoom, panX, panY, docToScreen, shown.x, shown.y, shown.width,
    shown.height, cropMode, crop, cropDraft, cursor, tool, brushSize, docW, docH, showMaskOverlay,
  ]);

  // -------------------------------------------------------------------------
  // Interaction
  // -------------------------------------------------------------------------

  const drag = useRef<{
    kind: 'pan' | 'crop' | 'brush';
    handle: CropHandle;
    startScreen: { x: number; y: number };
    startDoc: { x: number; y: number };
    startPan: { x: number; y: number };
    startRect: CropRect | null;
    lastDoc: { x: number; y: number };
  } | null>(null);

  const cropHandleAt = useCallback(
    (px: number, py: number, rect: CropRect): CropHandle => {
      const a = docToScreen(rect.x, rect.y);
      const b = docToScreen(rect.x + rect.width, rect.y + rect.height);
      const near = (v: number, target: number) => Math.abs(v - target) <= HANDLE_HIT;
      const insideX = px >= a.x - HANDLE_HIT && px <= b.x + HANDLE_HIT;
      const insideY = py >= a.y - HANDLE_HIT && py <= b.y + HANDLE_HIT;
      if (!insideX || !insideY) return null;

      const onLeft = near(px, a.x);
      const onRight = near(px, b.x);
      const onTop = near(py, a.y);
      const onBottom = near(py, b.y);

      if (onTop && onLeft) return 'nw';
      if (onTop && onRight) return 'ne';
      if (onBottom && onLeft) return 'sw';
      if (onBottom && onRight) return 'se';
      if (onTop) return 'n';
      if (onBottom) return 's';
      if (onLeft) return 'w';
      if (onRight) return 'e';
      if (px > a.x && px < b.x && py > a.y && py < b.y) return 'move';
      return null;
    },
    [docToScreen],
  );

  const runWand = useCallback(
    (docX: number, docY: number, restore: boolean) => {
      const s = useRasterStore.getState();
      if (!s.orientedPixels || !s.oriented) return;
      s.pushHistory();
      const mask = s.ensureMask();
      const sel = magicWand(
        s.orientedPixels.data,
        s.oriented.width,
        s.oriented.height,
        docX,
        docY,
        {
          tolerance: s.wandTolerance,
          contiguous: s.wandContiguous,
          feather: s.wandFeather,
          expand: s.wandExpand,
        },
      );
      applySelection(mask, sel, restore ? 'restore' : 'erase');
      syncMaskCanvas(mask, s.oriented.width, s.oriented.height);
      s.touchMask();
    },
    [],
  );

  const dab = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    const s = useRasterStore.getState();
    if (!s.oriented) return;
    const mask = s.mask ?? s.ensureMask();
    const radius = s.brushSize / 2;
    const mode = s.tool === 'restore' ? 'restore' : 'erase';

    // Interpolate so a fast drag doesn't leave gaps between dabs.
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(dist / Math.max(1, radius * 0.25)));
    let bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const r = paintBrush(
        mask, s.oriented.width, s.oriented.height,
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t,
        radius, s.brushHardness, s.brushStrength * 0.35, mode,
      );
      if (!r) continue;
      bounds = bounds
        ? {
            minX: Math.min(bounds.minX, r.minX), minY: Math.min(bounds.minY, r.minY),
            maxX: Math.max(bounds.maxX, r.maxX), maxY: Math.max(bounds.maxY, r.maxY),
          }
        : r;
    }
    if (bounds) syncMaskRect(mask, s.oriented.width, s.oriented.height, bounds);
    recompose(true);
  }, [recompose]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!oriented) return;
      const p = localPoint(e);
      const doc = screenToDoc(p.x, p.y);
      const s = useRasterStore.getState();
      (e.target as Element).setPointerCapture(e.pointerId);

      const wantsPan = e.button === 1 || e.altKey || s.tool === 'move' || e.shiftKey === false && e.button === 2;
      if (e.button === 1 || (s.tool === 'move' && e.button === 0)) {
        drag.current = {
          kind: 'pan', handle: null, startScreen: p, startDoc: doc,
          startPan: { x: s.panX, y: s.panY }, startRect: null, lastDoc: doc,
        };
        return;
      }

      if (s.tool === 'crop') {
        const rect = s.cropDraft ?? s.crop ?? { x: 0, y: 0, width: oriented.width, height: oriented.height };
        const handle = cropHandleAt(p.x, p.y, rect);
        drag.current = {
          kind: 'crop',
          handle: handle ?? 'nw',
          startScreen: p, startDoc: doc,
          startPan: { x: s.panX, y: s.panY },
          startRect: handle ? rect : { x: doc.x, y: doc.y, width: 0, height: 0 },
          lastDoc: doc,
        };
        if (!handle) s.setCropDraft({ x: doc.x, y: doc.y, width: 0, height: 0 });
        return;
      }

      if (s.tool === 'wand') {
        runWand(doc.x, doc.y, e.altKey);
        return;
      }

      if (s.tool === 'eraser' || s.tool === 'restore') {
        s.pushHistory();
        s.ensureMask();
        strokeActive.current = true;
        drag.current = {
          kind: 'brush', handle: null, startScreen: p, startDoc: doc,
          startPan: { x: s.panX, y: s.panY }, startRect: null, lastDoc: doc,
        };
        dab(doc, doc);
        return;
      }

      if (s.tool === 'picker') {
        const px = s.orientedPixels;
        if (px) {
          const ix = Math.round(doc.x);
          const iy = Math.round(doc.y);
          if (ix >= 0 && iy >= 0 && ix < px.width && iy < px.height) {
            const i = (iy * px.width + ix) * 4;
            const hex = `#${[px.data[i], px.data[i + 1], px.data[i + 2]]
              .map((v) => v.toString(16).padStart(2, '0'))
              .join('')}`;
            void navigator.clipboard.writeText(hex);
            window.dispatchEvent(new CustomEvent('inj:picked', { detail: hex }));
          }
        }
        return;
      }

      void wantsPan;
    },
    [oriented, localPoint, screenToDoc, cropHandleAt, runWand, dab],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const p = localPoint(e);
      setCursor(p);
      const state = drag.current;
      if (!state || !oriented) return;
      const doc = screenToDoc(p.x, p.y);
      const s = useRasterStore.getState();

      if (state.kind === 'pan') {
        s.setView(s.zoom, state.startPan.x + (p.x - state.startScreen.x), state.startPan.y + (p.y - state.startScreen.y));
        return;
      }

      if (state.kind === 'brush') {
        dab(state.lastDoc, doc);
        state.lastDoc = doc;
        return;
      }

      if (state.kind === 'crop' && state.startRect) {
        const next = resizeCrop(
          state.startRect, state.handle, doc.x - state.startDoc.x, doc.y - state.startDoc.y,
          oriented.width, oriented.height, cropAspect, e.shiftKey,
        );
        s.setCropDraft(next);
      }
    },
    [localPoint, screenToDoc, oriented, dab, cropAspect],
  );

  const onPointerUp = useCallback(() => {
    const state = drag.current;
    drag.current = null;
    if (state?.kind === 'brush') {
      strokeActive.current = false;
      useRasterStore.getState().touchMask();
      recompose();
    }
  }, [recompose]);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const s = useRasterStore.getState();
      const p = localPoint(e);

      if (e.ctrlKey || e.metaKey) {
        // Pinch / cmd-scroll: zoom around the cursor so it stays put.
        const before = screenToDoc(p.x, p.y);
        const next = Math.min(32, Math.max(0.02, s.zoom * Math.exp(-e.deltaY * 0.01)));
        const centerX = shown.x + shown.width / 2;
        const centerY = shown.y + shown.height / 2;
        s.setView(
          next,
          p.x - size.w / 2 - (before.x - centerX) * next,
          p.y - size.h / 2 - (before.y - centerY) * next,
        );
      } else {
        s.setView(s.zoom, s.panX - e.deltaX, s.panY - e.deltaY);
      }
    },
    [localPoint, screenToDoc, shown.x, shown.y, shown.width, shown.height, size.w, size.h],
  );

  // Fit / 100% shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key === '0') { e.preventDefault(); fitToView(); }
      if (e.key === '1') { e.preventDefault(); useRasterStore.getState().setView(1, 0, 0); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitToView]);

  const cursorStyle =
    tool === 'move' ? 'grab'
    : tool === 'crop' ? 'crosshair'
    : tool === 'wand' || tool === 'picker' ? 'crosshair'
    : tool === 'eraser' || tool === 'restore' ? 'none'
    : 'default';

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-[#101116]"
      style={{ cursor: cursorStyle }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setCursor(null)}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />
      <ZoomBadge zoom={zoom} onFit={fitToView} />
    </div>
  );
}

function ZoomBadge({ zoom, onFit }: { zoom: number; onFit: () => void }) {
  return (
    <div className="absolute bottom-3 left-3 flex items-center gap-1 bg-panel-2/90 border border-border rounded-md px-1.5 py-1 backdrop-blur">
      <button
        onClick={() => useRasterStore.getState().setZoom(zoom / 1.25)}
        className="w-5 h-5 rounded text-gray-400 hover:text-white hover:bg-panel-3 text-xs leading-none"
      >
        −
      </button>
      <button
        onClick={onFit}
        className="text-[10px] font-mono text-gray-300 w-12 text-center hover:text-white"
        title="Вписать (0)"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        onClick={() => useRasterStore.getState().setZoom(zoom * 1.25)}
        className="w-5 h-5 rounded text-gray-400 hover:text-white hover:bg-panel-3 text-xs leading-none"
      >
        +
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Canvas painting helpers
// ---------------------------------------------------------------------------

function drawCheckerboard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const cell = 8;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#2a2b33';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#33353f';
  const startX = Math.floor(x / cell) * cell;
  const startY = Math.floor(y / cell) * cell;
  for (let py = startY; py < y + h; py += cell) {
    for (let px = startX; px < x + w; px += cell) {
      if (((px / cell) + (py / cell)) % 2 === 0) ctx.fillRect(px, py, cell, cell);
    }
  }
  ctx.restore();
}

/** Tints the erased area so a nearly-invisible cut is still obvious. */
function drawMaskOverlay(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = 'rgba(255, 80, 80, 0.28)';
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function drawCropOverlay(
  ctx: CanvasRenderingContext2D,
  rect: CropRect,
  docToScreen: (x: number, y: number) => { x: number; y: number },
  size: { w: number; h: number },
) {
  const a = docToScreen(rect.x, rect.y);
  const b = docToScreen(rect.x + rect.width, rect.y + rect.height);
  const w = b.x - a.x;
  const h = b.y - a.y;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.rect(0, 0, size.w, size.h);
  ctx.rect(a.x, a.y, w, h);
  ctx.fill('evenodd');

  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1;
  ctx.strokeRect(a.x + 0.5, a.y + 0.5, w, h);

  // Rule-of-thirds guides
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  for (let i = 1; i < 3; i++) {
    ctx.moveTo(a.x + (w * i) / 3, a.y);
    ctx.lineTo(a.x + (w * i) / 3, b.y);
    ctx.moveTo(a.x, a.y + (h * i) / 3);
    ctx.lineTo(b.x, a.y + (h * i) / 3);
  }
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  const s = 7;
  const points: [number, number][] = [
    [a.x, a.y], [a.x + w / 2, a.y], [b.x, a.y],
    [b.x, a.y + h / 2], [b.x, b.y], [a.x + w / 2, b.y],
    [a.x, b.y], [a.x, a.y + h / 2],
  ];
  for (const [px, py] of points) {
    ctx.fillRect(px - s / 2, py - s / 2, s, s);
  }

  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  const label = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  ctx.font = '11px ui-monospace, monospace';
  const tw = ctx.measureText(label).width;
  ctx.fillRect(a.x, a.y - 20, tw + 12, 16);
  ctx.fillStyle = '#fff';
  ctx.fillText(label, a.x + 6, a.y - 8);
  ctx.restore();
}

function resizeCrop(
  start: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  maxW: number,
  maxH: number,
  aspect: number | null,
  shift: boolean,
): CropRect {
  let { x, y, width, height } = start;

  if (handle === 'move') {
    x = Math.max(0, Math.min(maxW - width, x + dx));
    y = Math.max(0, Math.min(maxH - height, y + dy));
    return { x, y, width, height };
  }

  let left = x;
  let top = y;
  let right = x + width;
  let bottom = y + height;

  if (handle?.includes('w')) left = x + dx;
  if (handle?.includes('e')) right = x + width + dx;
  if (handle?.includes('n')) top = y + dy;
  if (handle?.includes('s')) bottom = y + height + dy;

  // A fresh drag has no handle semantics yet — treat it as a free corner drag.
  if (handle === 'nw' && start.width === 0 && start.height === 0) {
    left = Math.min(start.x, start.x + dx);
    top = Math.min(start.y, start.y + dy);
    right = Math.max(start.x, start.x + dx);
    bottom = Math.max(start.y, start.y + dy);
  }

  left = Math.max(0, Math.min(left, maxW));
  top = Math.max(0, Math.min(top, maxH));
  right = Math.max(0, Math.min(right, maxW));
  bottom = Math.max(0, Math.min(bottom, maxH));

  let w = Math.max(1, right - left);
  let h = Math.max(1, bottom - top);

  const ratio = aspect ?? (shift ? w / h : null);
  if (ratio) {
    // Grow along the dominant axis so the box tracks the pointer naturally.
    if (w / h > ratio) h = w / ratio;
    else w = h * ratio;
    if (handle?.includes('w')) left = right - w;
    if (handle?.includes('n')) top = bottom - h;
    w = Math.min(w, maxW - left);
    h = Math.min(h, maxH - top);
  }

  return { x: left, y: top, width: w, height: h };
}
