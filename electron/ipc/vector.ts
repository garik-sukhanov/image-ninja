import type { IpcMain } from 'electron';
import {
  vectorizeRaw,
  ColorMode,
  Hierarchical,
  PathSimplifyMode,
} from '@neplex/vectorizer';
import type { TraceOptions, TraceResult } from '../../src/types.js';

/**
 * Raster → vector via VTracer. It runs on a napi worker thread, so a big trace
 * never blocks the main process's event loop.
 */
function toConfig(opts: TraceOptions) {
  return {
    colorMode: opts.mode === 'bw' ? ColorMode.Binary : ColorMode.Color,
    hierarchical: opts.hierarchical === 'cutout' ? Hierarchical.Cutout : Hierarchical.Stacked,
    mode:
      opts.curve === 'polygon' ? PathSimplifyMode.Polygon
      : opts.curve === 'none' ? PathSimplifyMode.None
      : PathSimplifyMode.Spline,
    filterSpeckle: Math.max(0, Math.round(opts.filterSpeckle)),
    colorPrecision: Math.min(8, Math.max(1, Math.round(opts.colorPrecision))),
    layerDifference: Math.max(0, Math.round(opts.layerDifference)),
    cornerThreshold: Math.max(0, Math.round(opts.cornerThreshold)),
    lengthThreshold: Math.max(0.5, opts.lengthThreshold),
    maxIterations: 10,
    spliceThreshold: Math.max(0, Math.round(opts.spliceThreshold)),
    pathPrecision: 2,
  };
}

async function trace(
  width: number,
  height: number,
  rgba: Uint8Array,
  opts: TraceOptions,
): Promise<TraceResult> {
  if (width < 2 || height < 2) throw new Error('изображение слишком маленькое');
  const expected = width * height * 4;
  if (rgba.byteLength !== expected) {
    throw new Error(`ожидалось ${expected} байт RGBA, получено ${rgba.byteLength}`);
  }

  const started = Date.now();
  const svg = await vectorizeRaw(Buffer.from(rgba), { width, height }, toConfig(opts));
  return {
    svg,
    width,
    height,
    pathCount: (svg.match(/<path/g) ?? []).length,
    ms: Date.now() - started,
  };
}

export function registerVectorHandlers(ipcMain: IpcMain) {
  ipcMain.handle(
    'vector:trace',
    (_e, width: number, height: number, rgba: Uint8Array, opts: TraceOptions) =>
      trace(width, height, rgba, opts),
  );
}
