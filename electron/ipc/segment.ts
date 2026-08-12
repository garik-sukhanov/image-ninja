import type { BrowserWindow, IpcMain } from 'electron';
import { app } from 'electron';
import sharp from 'sharp';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import type { ModelStatus, SegmentResult } from '../../src/types.js';

/**
 * Salient-object segmentation models from the rembg release bundle. All are
 * plain ONNX, run locally on CPU — nothing leaves the machine.
 */
interface ModelSpec {
  id: string;
  file: string;
  label: string;
  sizeMb: number;
  url: string;
  /** Network input resolution (square). */
  input: number;
  mean: [number, number, number];
  std: [number, number, number];
}

const REMBG_RELEASE = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0';

export const MODELS: Record<string, ModelSpec> = {
  u2netp: {
    id: 'u2netp',
    file: 'u2netp.onnx',
    label: 'U²-Net Lite — быстрый',
    sizeMb: 4.4,
    url: `${REMBG_RELEASE}/u2netp.onnx`,
    input: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
  },
  u2net: {
    id: 'u2net',
    file: 'u2net.onnx',
    label: 'U²-Net — универсальный',
    sizeMb: 168,
    url: `${REMBG_RELEASE}/u2net.onnx`,
    input: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
  },
  isnet: {
    id: 'isnet',
    file: 'isnet-general-use.onnx',
    label: 'IS-Net — максимальное качество',
    sizeMb: 170,
    url: `${REMBG_RELEASE}/isnet-general-use.onnx`,
    input: 1024,
    mean: [0.5, 0.5, 0.5],
    std: [1.0, 1.0, 1.0],
  },
};

/** Bundled models ship in Resources; downloaded ones land in userData. */
function modelSearchPaths(spec: ModelSpec): string[] {
  return [
    join(app.getPath('userData'), 'models', spec.file),
    join(process.resourcesPath ?? '', 'models', spec.file),
    join(app.getAppPath(), 'build', 'vendor', 'models', spec.file),
  ];
}

function resolveModel(spec: ModelSpec): string | null {
  return modelSearchPaths(spec).find((p) => p && existsSync(p)) ?? null;
}

function modelStatus(id: string): ModelStatus {
  const spec = MODELS[id] ?? MODELS.u2net;
  const path = resolveModel(spec);
  return { installed: Boolean(path), name: spec.label, sizeMb: spec.sizeMb, path: path ?? '' };
}

async function downloadModel(id: string, win: BrowserWindow | null): Promise<ModelStatus> {
  const spec = MODELS[id];
  if (!spec) throw new Error(`unknown model: ${id}`);

  const existing = resolveModel(spec);
  if (existing) return modelStatus(id);

  const dir = join(app.getPath('userData'), 'models');
  await mkdir(dir, { recursive: true });
  const dest = join(dir, spec.file);
  const tmp = `${dest}.part`;
  // A previous attempt killed mid-flight leaves a partial file behind; start
  // clean rather than appending to it.
  if (existsSync(tmp)) await unlink(tmp).catch(() => {});

  const res = await fetch(spec.url);
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);

  const total = Number(res.headers.get('content-length') ?? 0);
  let received = 0;

  const source = Readable.fromWeb(res.body as never);
  source.on('data', (chunk: Buffer) => {
    received += chunk.length;
    win?.webContents.send('segment:downloadProgress', { received, total });
  });

  try {
    await pipeline(source, createWriteStream(tmp));
    await rename(tmp, dest);
  } catch (e) {
    if (existsSync(tmp)) await unlink(tmp).catch(() => {});
    throw e;
  }

  return modelStatus(id);
}

async function removeModel(id: string): Promise<boolean> {
  const spec = MODELS[id];
  if (!spec) return false;
  // Only the user-downloaded copy is removable; bundled ones stay put.
  const path = join(app.getPath('userData'), 'models', spec.file);
  if (!existsSync(path)) return false;
  await unlink(path);
  return true;
}

// Sessions are expensive to build (hundreds of MB), so keep one alive per model.
type OrtSession = { run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>; inputNames: string[]; outputNames: string[] };
const sessions = new Map<string, OrtSession>();

async function getSession(spec: ModelSpec): Promise<OrtSession> {
  const cached = sessions.get(spec.id);
  if (cached) return cached;

  const path = resolveModel(spec);
  if (!path) throw new Error(`model-missing:${spec.id}`);

  const ort = await import('onnxruntime-node');
  const session = (await ort.InferenceSession.create(path, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  })) as unknown as OrtSession;
  sessions.set(spec.id, session);
  return session;
}

/**
 * Runs salient-object segmentation over raw RGBA from the renderer and returns
 * a full-resolution 8-bit foreground mask.
 *
 * Pre/post-processing mirrors rembg: normalise by the batch max (not 255),
 * mean/std per channel, NCHW; then min-max stretch the first output map.
 */
async function segment(
  id: string,
  width: number,
  height: number,
  rgba: Uint8Array,
): Promise<SegmentResult> {
  const spec = MODELS[id] ?? MODELS.u2net;
  const session = await getSession(spec);
  const ort = await import('onnxruntime-node');
  const N = spec.input;

  // Drop alpha, then let libvips do the (lanczos) downscale to the net input.
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }
  const small = await sharp(rgb, { raw: { width, height, channels: 3 } })
    .resize(N, N, { fit: 'fill', kernel: 'lanczos3' })
    .toColourspace('srgb')
    .raw()
    .toBuffer();

  let max = 0;
  for (let i = 0; i < small.length; i++) if (small[i] > max) max = small[i];
  if (max === 0) max = 255;

  const plane = N * N;
  const input = new Float32Array(plane * 3);
  for (let p = 0; p < plane; p++) {
    const s = p * 3;
    input[p] = (small[s] / max - spec.mean[0]) / spec.std[0];
    input[plane + p] = (small[s + 1] / max - spec.mean[1]) / spec.std[1];
    input[plane * 2 + p] = (small[s + 2] / max - spec.mean[2]) / spec.std[2];
  }

  const tensor = new ort.Tensor('float32', input, [1, 3, N, N]);
  const outputs = await session.run({ [session.inputNames[0]]: tensor });
  const pred = outputs[session.outputNames[0]].data as Float32Array;

  // The first output map is the fused prediction; stretch it to full range.
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < plane; i++) {
    const v = pred[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;

  const maskSmall = Buffer.alloc(plane);
  for (let i = 0; i < plane; i++) {
    maskSmall[i] = Math.round(((pred[i] - lo) / span) * 255);
  }

  // `toColourspace('b-w')` is load-bearing: without it libvips promotes the
  // single-channel mask to 3-channel sRGB on resize, and the caller would index
  // into a buffer three times the size it expects.
  const maskFull = await sharp(maskSmall, { raw: { width: N, height: N, channels: 1 } })
    .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
    .toColourspace('b-w')
    .raw()
    .toBuffer();

  if (maskFull.length !== width * height) {
    throw new Error(`mask size mismatch: got ${maskFull.length}, expected ${width * height}`);
  }
  return { width, height, mask: new Uint8Array(maskFull) };
}

export function registerSegmentHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null) {
  ipcMain.handle('segment:models', () =>
    Object.values(MODELS).map((m) => ({ id: m.id, ...modelStatus(m.id) })),
  );
  ipcMain.handle('segment:status', (_e, id: string) => modelStatus(id));
  ipcMain.handle('segment:download', (_e, id: string) => downloadModel(id, getWindow()));
  ipcMain.handle('segment:remove', (_e, id: string) => removeModel(id));
  ipcMain.handle(
    'segment:run',
    (_e, id: string, width: number, height: number, rgba: Uint8Array) =>
      segment(id, width, height, rgba),
  );
  ipcMain.handle('segment:modelBytes', async (_e, id: string) => {
    const spec = MODELS[id];
    const path = spec ? resolveModel(spec) : null;
    if (!path) return 0;
    return (await stat(path)).size;
  });
}
