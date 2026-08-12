import { useAppStore, metaToOpen } from './appStore';
import { useRasterStore } from './raster/rasterStore';
import { useSvgStore } from './svg/svgStore';
import { composePoster } from './raster/compose';
import { dropMaskCanvas, syncMaskCanvas } from './raster/maskCanvas';
import { parseSvg } from './svg/parse';
import { serializeSvg } from './svg/serialize';
import {
  DEFAULT_EXPORT,
  NEUTRAL_ADJUSTMENTS,
  SCHEMA_VERSION,
  type ProjectDocument,
  type RasterDocument,
  type SvgDocument,
} from './types';

const AUTOSAVE_DEBOUNCE_MS = 800;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Mask side-car — stored as a PNG so it is self-describing and compresses well
// ---------------------------------------------------------------------------

async function maskToPng(mask: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, height);
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = mask[p];
  }
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return new Uint8Array();
  return new Uint8Array(await blob.arrayBuffer());
}

async function maskFromPng(bytes: Uint8Array, width: number, height: number): Promise<Uint8Array | null> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);
  if (bitmap.width !== width || bitmap.height !== height) {
    // The source image changed shape since the mask was saved — drop it rather
    // than silently misaligning every pixel.
    bitmap.close();
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const img = ctx.getImageData(0, 0, width, height);
  const mask = new Uint8Array(width * height);
  for (let p = 0, i = 3; p < mask.length; p++, i += 4) mask[p] = img.data[i];
  return mask;
}

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

export function buildDocument(): ProjectDocument | null {
  const app = useAppStore.getState();
  if (!app.current) return null;
  const base = {
    schemaVersion: SCHEMA_VERSION,
    id: app.current.id,
    name: app.current.name,
    createdAt: app.current.createdAt,
    updatedAt: new Date().toISOString(),
  };

  if (app.current.kind === 'svg') {
    const s = useSvgStore.getState();
    const doc: SvgDocument = {
      ...base,
      kind: 'svg',
      canvas: s.canvas,
      rootAttrs: s.rootAttrs,
      defs: s.defs,
      order: s.order,
      nodes: s.nodes,
      sourcePath: s.sourcePath,
      underlay: s.underlay,
      exportSettings: s.exportSettings,
      ui: { zoom: s.zoom, panX: s.panX, panY: s.panY },
    };
    return doc;
  }

  const s = useRasterStore.getState();
  if (!s.source) return null;
  const doc: RasterDocument = {
    ...base,
    kind: 'raster',
    source: s.source,
    crop: s.crop,
    rotate: s.rotate,
    flipH: s.flipH,
    flipV: s.flipV,
    adjustments: s.adjustments,
    hasMask: Boolean(s.mask),
    exportSettings: s.exportSettings,
    ui: { zoom: s.zoom, panX: s.panX, panY: s.panY },
  };
  return doc;
}

/** Card thumbnail. SVG posters are rendered from the live document. */
async function buildPoster(): Promise<string | undefined> {
  const app = useAppStore.getState();
  if (!app.current) return undefined;

  if (app.current.kind === 'raster') {
    return composePoster() ?? undefined;
  }

  const s = useSvgStore.getState();
  if (s.order.length === 0) return undefined;
  const doc = buildDocument();
  if (!doc || doc.kind !== 'svg') return undefined;

  try {
    const source = serializeSvg(doc, { clean: true });
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const bitmap = await createImageBitmap(await fetch(url).then((r) => r.blob()));
      const max = 320;
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#26272f';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      return canvas.toDataURL('image/jpeg', 0.72);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return undefined;
  }
}

export async function saveCurrentProject(): Promise<void> {
  const doc = buildDocument();
  if (!doc) return;
  const app = useAppStore.getState();
  app.setSaving(true);
  try {
    if (doc.kind === 'raster') {
      const raster = useRasterStore.getState();
      if (raster.mask && raster.oriented) {
        const png = await maskToPng(raster.mask, raster.oriented.width, raster.oriented.height);
        await window.inj.projects.writeBlob(doc.id, 'mask.png', png);
      } else {
        await window.inj.projects.deleteBlob(doc.id, 'mask.png');
      }
    }
    const poster = await buildPoster();
    const meta = await window.inj.projects.save(doc, poster);
    useAppStore.getState().markSaved(meta.updatedAt);
    useAppStore.getState().bumpProjects();
  } catch (e) {
    console.error('project save failed', e);
    useAppStore.getState().setSaving(false);
    useAppStore.getState().showToast('Не удалось сохранить проект', 'error');
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveCurrentProject();
  }, AUTOSAVE_DEBOUNCE_MS);
}

/** Fields whose change means the document is dirty. View state (zoom/pan) is
 *  deliberately excluded so panning around doesn't spam the disk. */
function rasterSignature(s: ReturnType<typeof useRasterStore.getState>) {
  return [s.source, s.crop, s.rotate, s.flipH, s.flipV, s.adjustments, s.maskRevision, s.exportSettings];
}

function svgSignature(s: ReturnType<typeof useSvgStore.getState>) {
  return [s.nodes, s.order, s.defs, s.canvas, s.exportSettings, s.underlay];
}

export function startAutosave(kind: 'raster' | 'svg') {
  stopAutosave();
  if (kind === 'raster') {
    let prev = rasterSignature(useRasterStore.getState());
    unsubscribe = useRasterStore.subscribe((state) => {
      const next = rasterSignature(state);
      const changed = next.some((v, i) => v !== prev[i]);
      prev = next;
      if (!changed) return;
      useAppStore.getState().markDirty();
      scheduleSave();
    });
  } else {
    let prev = svgSignature(useSvgStore.getState());
    unsubscribe = useSvgStore.subscribe((state) => {
      const next = svgSignature(state);
      const changed = next.some((v, i) => v !== prev[i]);
      prev = next;
      if (!changed) return;
      useAppStore.getState().markDirty();
      scheduleSave();
    });
  }
}

export function stopAutosave() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

async function loadRasterInto(doc: RasterDocument): Promise<void> {
  const exists = await window.inj.pathExists(doc.source.filePath);
  let filePath = doc.source.filePath;
  if (!exists) {
    const relinked = await window.inj.relinkImageDialog(doc.source.fileName);
    if (!relinked) throw new Error(`Файл не найден: ${doc.source.fileName}`);
    filePath = relinked;
  }

  const { url } = await window.inj.image.prepare(filePath);
  const blob = await fetch(url).then((r) => r.blob());
  const bitmap = await createImageBitmap(blob);

  const source = { ...doc.source, filePath };
  const orientedW = doc.rotate === 90 || doc.rotate === 270 ? bitmap.height : bitmap.width;
  const orientedH = doc.rotate === 90 || doc.rotate === 270 ? bitmap.width : bitmap.height;

  let mask: Uint8Array | null = null;
  if (doc.hasMask) {
    const bytes = await window.inj.projects.readBlob(doc.id, 'mask.png');
    if (bytes) mask = await maskFromPng(bytes, orientedW, orientedH);
  }

  dropMaskCanvas();
  useRasterStore.getState().loadDocument({ ...doc, source }, bitmap, mask);
  if (mask) syncMaskCanvas(mask, orientedW, orientedH);
}

/** Resolves the underlay's on-disk path into a URL the renderer can display. */
async function resolveUnderlay(doc: SvgDocument): Promise<void> {
  const underlay = doc.underlay;
  if (!underlay) return;
  try {
    if (!(await window.inj.pathExists(underlay.filePath))) {
      // The reference image moved; keep the placement but show nothing rather
      // than failing the whole project open.
      useSvgStore.setState({ underlayUrl: null });
      useAppStore.getState().showToast(`Подложка не найдена: ${underlay.fileName}`, 'error');
      return;
    }
    const { url } = await window.inj.image.prepare(underlay.filePath);
    useSvgStore.setState({ underlayUrl: url });
  } catch {
    useSvgStore.setState({ underlayUrl: null });
  }
}

async function afterOpen(doc: ProjectDocument) {
  if (doc.kind === 'svg') {
    useSvgStore.getState().loadDocument(doc);
    void resolveUnderlay(doc);
  } else {
    await loadRasterInto(doc);
  }
  useAppStore.getState().setCurrent(metaToOpen(doc));
  useAppStore.getState().setView('editor');
  startAutosave(doc.kind);
}

export async function openProject(id: string): Promise<void> {
  const doc = await window.inj.projects.load(id);
  await afterOpen(doc);
}

/** Creates projects from files picked in the open dialog (or dropped in). */
export async function createProjectsFromFiles(filePaths: string[]): Promise<string | null> {
  let lastId: string | null = null;
  for (const filePath of filePaths) {
    const isSvg = filePath.toLowerCase().endsWith('.svg');
    const baseName = await window.inj.image.baseName(filePath);
    const now = new Date().toISOString();

    if (isSvg) {
      const source = await window.inj.svg.read(filePath);
      const parsed = parseSvg(source);
      const doc: SvgDocument = {
        schemaVersion: SCHEMA_VERSION,
        kind: 'svg',
        id: '',
        name: baseName,
        createdAt: now,
        updatedAt: now,
        canvas: parsed.canvas,
        rootAttrs: parsed.rootAttrs,
        defs: parsed.defs,
        order: parsed.order,
        nodes: parsed.nodes,
        sourcePath: filePath,
        exportSettings: { ...DEFAULT_EXPORT, format: 'svg' },
        ui: { zoom: 1, panX: 0, panY: 0 },
      };
      const created = await window.inj.projects.create(doc);
      lastId = created.id;
    } else {
      const probe = await window.inj.image.probe(filePath);
      const doc: RasterDocument = {
        schemaVersion: SCHEMA_VERSION,
        kind: 'raster',
        id: '',
        name: baseName,
        createdAt: now,
        updatedAt: now,
        source: {
          filePath,
          fileName: filePath.split('/').pop() ?? filePath,
          width: probe.width,
          height: probe.height,
          format: probe.format,
          hasAlpha: probe.hasAlpha,
        },
        crop: null,
        rotate: 0,
        flipH: false,
        flipV: false,
        adjustments: { ...NEUTRAL_ADJUSTMENTS },
        hasMask: false,
        exportSettings: { ...DEFAULT_EXPORT, format: probe.hasAlpha ? 'png' : 'jpeg' },
        ui: { zoom: 1, panX: 0, panY: 0 },
      };
      const created = await window.inj.projects.create(doc);
      lastId = created.id;
    }
  }
  useAppStore.getState().bumpProjects();
  return lastId;
}

/** Blank SVG artboard. */
export async function createBlankSvg(width = 512, height = 512, name = 'Новый SVG'): Promise<string> {
  const now = new Date().toISOString();
  const doc: SvgDocument = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'svg',
    id: '',
    name,
    createdAt: now,
    updatedAt: now,
    canvas: { width, height, viewBox: [0, 0, width, height] },
    rootAttrs: {},
    defs: '',
    order: [],
    nodes: {},
    exportSettings: { ...DEFAULT_EXPORT, format: 'svg' },
    ui: { zoom: 1, panX: 0, panY: 0 },
  };
  const created = await window.inj.projects.create(doc);
  useAppStore.getState().bumpProjects();
  return created.id;
}

export async function closeToProjects(): Promise<void> {
  await saveCurrentProject();
  stopAutosave();
  dropMaskCanvas();
  useAppStore.getState().setView('projects');
  useAppStore.getState().setCurrent(null);
  useAppStore.getState().bumpProjects();
  useRasterStore.getState().reset();
  useSvgStore.getState().reset();
}

/** Wire the quit handshake once at startup so the open project is flushed. */
export function installQuitFlush() {
  window.inj.onFlushSave(async () => {
    if (useAppStore.getState().current) {
      await saveCurrentProject();
    }
    window.inj.flushSaveDone();
  });
}
