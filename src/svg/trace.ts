import { parseSvg, type ParsedSvg } from './parse';
import { pathBBox } from './path';
import { useSvgStore } from './svgStore';
import type { TraceOptions } from '../types';

/**
 * Tracing above this resolution buys detail nobody can see and costs a huge
 * path count, so the source is downscaled to it first. Vector output is
 * resolution-independent afterwards either way.
 */
export const MAX_TRACE_SIZE = 2048;

export interface TraceSource {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** Reads an image URL into RGBA, downscaled to the tracing cap. */
export async function rgbaFromUrl(url: string): Promise<TraceSource> {
  const img = new Image();
  img.src = url;
  await img.decode();

  const scale = Math.min(1, MAX_TRACE_SIZE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(2, Math.round(img.naturalWidth * scale));
  const height = Math.max(2, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);
  return { width, height, pixels: new Uint8Array(data.data.buffer.slice(0)) };
}

/** Downscales an already-composed canvas to the tracing cap. */
export function rgbaFromCanvas(canvas: HTMLCanvasElement): TraceSource {
  const scale = Math.min(1, MAX_TRACE_SIZE / Math.max(canvas.width, canvas.height));
  const width = Math.max(2, Math.round(canvas.width * scale));
  const height = Math.max(2, Math.round(canvas.height * scale));

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);
  return { width, height, pixels: new Uint8Array(data.data.buffer.slice(0)) };
}

/**
 * VTracer traces the backdrop too, so a logo on a white sheet comes back with
 * an opaque white rectangle as its bottom layer. Drop that first shape when it
 * spans nearly the whole frame — anything smaller is real artwork and stays.
 */
export function dropBackgroundPath(parsed: ParsedSvg): boolean {
  const firstId = parsed.order[0];
  const node = firstId ? parsed.nodes[firstId] : null;
  if (!node || node.tag !== 'path' || !node.attrs.d) return false;

  const [, , vw, vh] = parsed.canvas.viewBox;
  if (!vw || !vh) return false;

  const box = pathBBox(node.attrs.d);
  if (!box) return false;
  if (box.width * box.height < vw * vh * 0.9) return false;

  parsed.order.shift();
  delete parsed.nodes[firstId];
  return true;
}

export interface TraceIntoResult {
  groupId: string;
  pathCount: number;
  ms: number;
  droppedBackground: boolean;
}

/**
 * Traces a raster source and drops the result into the open SVG document as
 * one group, scaled onto `rect`.
 */
export async function traceInto(
  source: TraceSource,
  rect: { x: number; y: number; width: number; height: number },
  options: TraceOptions,
  name = 'Векторизация',
): Promise<TraceIntoResult> {
  const result = await window.inj.vector.trace(
    source.width,
    source.height,
    source.pixels,
    options,
  );

  const parsed = parseSvg(result.svg);
  const droppedBackground = options.dropBackground ? dropBackgroundPath(parsed) : false;

  // VTracer emits its own pixel coordinate system; map it onto the target box.
  const [, , vw, vh] = parsed.canvas.viewBox;
  const sx = rect.width / (vw || source.width);
  const sy = rect.height / (vh || source.height);
  const transform =
    `translate(${round(rect.x)} ${round(rect.y)})` +
    (sx !== 1 || sy !== 1 ? ` scale(${round(sx)} ${round(sy)})` : '');

  const groupId = useSvgStore.getState().insertParsed(parsed, transform, name);
  return {
    groupId,
    pathCount: parsed.order.length ? countPaths(parsed) : result.pathCount,
    ms: result.ms,
    droppedBackground,
  };
}

function countPaths(parsed: ParsedSvg): number {
  return Object.values(parsed.nodes).filter((n) => n.tag === 'path').length;
}

/** Traces to a parsed SVG (for "raster → new SVG project"). */
export async function traceToParsed(
  source: TraceSource,
  options: TraceOptions,
): Promise<{ parsed: ParsedSvg; pathCount: number; ms: number; droppedBackground: boolean }> {
  const result = await window.inj.vector.trace(
    source.width,
    source.height,
    source.pixels,
    options,
  );
  const parsed = parseSvg(result.svg);
  const droppedBackground = options.dropBackground ? dropBackgroundPath(parsed) : false;
  return { parsed, pathCount: countPaths(parsed), ms: result.ms, droppedBackground };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
