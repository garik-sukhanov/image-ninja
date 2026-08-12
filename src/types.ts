export const SCHEMA_VERSION = 1;

export type ProjectKind = 'raster' | 'svg';

/** Card-level info for the projects screen — cheap to read, never holds pixels. */
export interface ProjectMeta {
  id: string;
  kind: ProjectKind;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Small data-URL preview shown on the project card. */
  poster?: string;
  width: number;
  height: number;
  /** Original file this project was created from, if any. */
  sourceName?: string;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'avif' | 'tiff' | 'svg';

export const RASTER_FORMATS: ExportFormat[] = ['png', 'jpeg', 'webp', 'avif', 'tiff'];

export interface ExportSettings {
  format: ExportFormat;
  /** 1..100, ignored by png/tiff. */
  quality: number;
  /** Multiplier applied to the document size; overridden by explicit width/height. */
  scale: number;
  width: number | null;
  height: number | null;
  /** Hex colour used to flatten transparency; null keeps the alpha channel. */
  background: string | null;
  /** Run svgo before writing (svg export only). */
  optimizeSvg: boolean;
}

export const DEFAULT_EXPORT: ExportSettings = {
  format: 'png',
  quality: 90,
  scale: 1,
  width: null,
  height: null,
  background: null,
  optimizeSvg: true,
};

/** RGBA pixels handed to sharp for encoding. */
export interface EncodeRequest {
  width: number;
  height: number;
  /** Raw RGBA, length = width * height * 4. */
  pixels: Uint8Array;
  settings: ExportSettings;
  outPath: string;
}

// ---------------------------------------------------------------------------
// Raster document
// ---------------------------------------------------------------------------

export interface Adjustments {
  /** -1..1 */
  exposure: number;
  brightness: number;
  contrast: number;
  saturation: number;
  vibrance: number;
  /** -1..1, cool → warm */
  temperature: number;
  /** -1..1, green → magenta */
  tint: number;
  /** -1..1, mapped to gamma 0.25..4 */
  gamma: number;
  /** -180..180 degrees */
  hue: number;
  /** 0..1 unsharp mask amount */
  sharpen: number;
  /** 0..1 gaussian blur amount */
  blur: number;
  /** 0..1 global layer alpha */
  opacity: number;
  /** Threshold below which alpha is snapped to 0 (cleans up mask fringes). */
  alphaFloor: number;
  invert: boolean;
  grayscale: boolean;
}

export const NEUTRAL_ADJUSTMENTS: Adjustments = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  gamma: 0,
  hue: 0,
  sharpen: 0,
  blur: 0,
  opacity: 1,
  alphaFloor: 0,
  invert: false,
  grayscale: false,
};

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export interface RasterSource {
  filePath: string;
  fileName: string;
  width: number;
  height: number;
  format: string;
  hasAlpha: boolean;
}

export interface RasterDocument {
  schemaVersion: number;
  kind: 'raster';
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  source: RasterSource;
  /** Crop in source-image pixels, applied after rotate/flip. */
  crop: CropRect | null;
  rotate: Rotation;
  flipH: boolean;
  flipV: boolean;
  adjustments: Adjustments;
  /** True when mask.png exists in the project folder. */
  hasMask: boolean;
  exportSettings: ExportSettings;
  ui: { zoom: number; panX: number; panY: number };
}

// ---------------------------------------------------------------------------
// SVG document
//
// The scene graph is a thin index over real SVG: `attrs` holds the element's
// attributes verbatim, so anything we don't understand still round-trips.
// ---------------------------------------------------------------------------

export interface SvgNode {
  id: string;
  /** SVG tag name: rect, circle, ellipse, line, polyline, polygon, path, text, g, image, … */
  tag: string;
  attrs: Record<string, string>;
  /** Child ids, in paint order. Only groups (`g`) have children. */
  children?: string[];
  /** Text content for <text> / <tspan>. */
  text?: string;
  /** Layer label shown in the layers panel. */
  name?: string;
  locked?: boolean;
  hidden?: boolean;
}

export interface SvgCanvas {
  width: number;
  height: number;
  viewBox: [number, number, number, number];
}

/**
 * A reference image shown *behind* the artboard for tracing over. It is not
 * part of the scene graph and never reaches the exported file.
 */
export interface Underlay {
  filePath: string;
  fileName: string;
  /** Placement in document units. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Intrinsic pixel size, kept so "1:1" and tracing know the real resolution. */
  naturalWidth: number;
  naturalHeight: number;
  opacity: number;
  visible: boolean;
  /** Locked underlays ignore the pointer, so drawing over them stays natural. */
  locked: boolean;
}

export interface SvgDocument {
  schemaVersion: number;
  kind: 'svg';
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  canvas: SvgCanvas;
  underlay?: Underlay | null;
  /** Attributes of the root <svg>, minus width/height/viewBox. */
  rootAttrs: Record<string, string>;
  /** Raw inner markup of <defs> — gradients, filters, clip paths, fonts. */
  defs: string;
  /** Top-level node ids in paint order. */
  order: string[];
  nodes: Record<string, SvgNode>;
  sourcePath?: string;
  exportSettings: ExportSettings;
  ui: { zoom: number; panX: number; panY: number };
}

export type ProjectDocument = RasterDocument | SvgDocument;

export function isSvgDoc(doc: ProjectDocument): doc is SvgDocument {
  return doc.kind === 'svg';
}

// ---------------------------------------------------------------------------
// Main-process image services
// ---------------------------------------------------------------------------

export interface ImageProbe {
  width: number;
  height: number;
  format: string;
  hasAlpha: boolean;
  space: string;
  channels: number;
  /** File size in bytes. */
  size: number;
  density?: number;
}

/** Decoded image handed to the renderer as raw RGBA. */
export interface DecodedImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface SegmentResult {
  width: number;
  height: number;
  /** Single-channel foreground probability, 0..255, one byte per pixel. */
  mask: Uint8Array;
}

export interface ModelStatus {
  installed: boolean;
  name: string;
  sizeMb: number;
  path: string;
}

// ---------------------------------------------------------------------------
// Vectorisation (VTracer)
// ---------------------------------------------------------------------------

export interface TraceOptions {
  /** Colour clustering, or a single black-and-white silhouette. */
  mode: 'color' | 'bw';
  /** Stack traced layers, or cut each one out of the one below. */
  hierarchical: 'stacked' | 'cutout';
  /** Curve fitting: splines are smooth, polygons are literal. */
  curve: 'spline' | 'polygon' | 'none';
  /** Discard blobs smaller than this many pixels. */
  filterSpeckle: number;
  /** Significant bits per RGB channel — higher keeps more distinct colours. */
  colorPrecision: number;
  /** Colour distance between layers — higher merges more. */
  layerDifference: number;
  /** Angle (deg) below which a joint counts as a corner. */
  cornerThreshold: number;
  /** Subdivide until every segment is shorter than this. */
  lengthThreshold: number;
  /** Angle (deg) below which a spline gets spliced. */
  spliceThreshold: number;
  /**
   * Drop the bottom-most traced shape when it covers almost the whole frame.
   * Tracing a logo on a white sheet otherwise hands you an opaque white
   * rectangle under the artwork. Applied after tracing, in the renderer.
   */
  dropBackground: boolean;
}

export const DEFAULT_TRACE: TraceOptions = {
  mode: 'color',
  hierarchical: 'stacked',
  curve: 'spline',
  filterSpeckle: 4,
  colorPrecision: 6,
  layerDifference: 16,
  cornerThreshold: 60,
  lengthThreshold: 4,
  spliceThreshold: 45,
  dropBackground: true,
};

export interface TraceResult {
  svg: string;
  width: number;
  height: number;
  pathCount: number;
  ms: number;
}

export interface DownloadProgress {
  received: number;
  total: number;
}
