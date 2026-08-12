import type { IpcMain } from 'electron';
import { app } from 'electron';
import sharp from 'sharp';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, extname, join } from 'node:path';
import type { EncodeRequest, ImageProbe } from '../../src/types.js';

/** Formats Chromium decodes natively — we can point an <img> straight at them. */
const NATIVE_DECODE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.svg']);

function cacheDir(): string {
  return join(app.getPath('userData'), 'Cache', 'decoded');
}

/** Stable cache key so a re-opened project reuses the previous transcode. */
function cacheKey(filePath: string, mtimeMs: number): string {
  return createHash('sha1').update(`${filePath}:${mtimeMs}`).digest('hex').slice(0, 16);
}

async function probeImage(filePath: string): Promise<ImageProbe> {
  const [meta, fileStat] = await Promise.all([sharp(filePath).metadata(), stat(filePath)]);
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format ?? extname(filePath).slice(1),
    hasAlpha: Boolean(meta.hasAlpha),
    space: meta.space ?? 'srgb',
    channels: meta.channels ?? 4,
    size: fileStat.size,
    density: meta.density,
  };
}

/**
 * Returns an `imgfile://` URL the renderer can load directly. TIFF/HEIC and
 * friends are transcoded to PNG once and cached, so the renderer never has to
 * know which formats Chromium supports.
 */
async function prepareForDisplay(filePath: string): Promise<{ url: string; transcoded: boolean }> {
  const ext = extname(filePath).toLowerCase();
  if (NATIVE_DECODE.has(ext)) {
    return { url: `imgfile://local${encodeURI(filePath)}`, transcoded: false };
  }

  const fileStat = await stat(filePath);
  const dir = cacheDir();
  await mkdir(dir, { recursive: true });
  const out = join(dir, `${cacheKey(filePath, fileStat.mtimeMs)}.png`);

  if (!existsSync(out)) {
    await sharp(filePath, { limitInputPixels: false }).png({ compressionLevel: 3 }).toFile(out);
  }
  return { url: `imgfile://local${encodeURI(out)}`, transcoded: true };
}

/** Encodes raw RGBA from the renderer into the requested file format. */
async function encodeImage(req: EncodeRequest): Promise<{ ok: boolean; path: string; size: number }> {
  const { width, height, settings, outPath } = req;
  const pixels = Buffer.from(req.pixels);

  let pipe = sharp(pixels, { raw: { width, height, channels: 4 } });

  // Explicit dimensions win over the scale multiplier.
  const targetW = settings.width ?? Math.max(1, Math.round(width * settings.scale));
  const targetH = settings.height ?? Math.max(1, Math.round(height * settings.scale));
  if (targetW !== width || targetH !== height) {
    pipe = pipe.resize(targetW, targetH, { fit: 'fill', kernel: 'lanczos3' });
  }

  // JPEG has no alpha, so it always needs a matte.
  const needsFlatten = settings.background !== null || settings.format === 'jpeg';
  if (needsFlatten) {
    pipe = pipe.flatten({ background: settings.background ?? '#ffffff' });
  }

  const q = Math.min(100, Math.max(1, Math.round(settings.quality)));
  switch (settings.format) {
    case 'jpeg':
      pipe = pipe.jpeg({ quality: q, mozjpeg: true, chromaSubsampling: q >= 90 ? '4:4:4' : '4:2:0' });
      break;
    case 'webp':
      pipe = pipe.webp({ quality: q, effort: 5, alphaQuality: 100 });
      break;
    case 'avif':
      pipe = pipe.avif({ quality: q, effort: 4 });
      break;
    case 'tiff':
      pipe = pipe.tiff({ compression: 'lzw' });
      break;
    case 'png':
    default:
      // Quality below 100 opts into palette quantisation — a big win for flat art.
      pipe = q >= 100
        ? pipe.png({ compressionLevel: 9 })
        : pipe.png({ compressionLevel: 9, palette: true, quality: q });
      break;
  }

  const info = await pipe.toFile(outPath);
  return { ok: true, path: outPath, size: info.size };
}

/** Byte size of an encode without writing it — powers the export size preview. */
async function estimateSize(req: Omit<EncodeRequest, 'outPath'>): Promise<number> {
  const { width, height, settings } = req;
  const pixels = Buffer.from(req.pixels);
  let pipe = sharp(pixels, { raw: { width, height, channels: 4 } });

  const targetW = settings.width ?? Math.max(1, Math.round(width * settings.scale));
  const targetH = settings.height ?? Math.max(1, Math.round(height * settings.scale));
  if (targetW !== width || targetH !== height) {
    pipe = pipe.resize(targetW, targetH, { fit: 'fill', kernel: 'lanczos3' });
  }
  if (settings.background !== null || settings.format === 'jpeg') {
    pipe = pipe.flatten({ background: settings.background ?? '#ffffff' });
  }

  const q = Math.min(100, Math.max(1, Math.round(settings.quality)));
  switch (settings.format) {
    case 'jpeg': pipe = pipe.jpeg({ quality: q, mozjpeg: true }); break;
    case 'webp': pipe = pipe.webp({ quality: q, effort: 3 }); break;
    case 'avif': pipe = pipe.avif({ quality: q, effort: 2 }); break;
    case 'tiff': pipe = pipe.tiff({ compression: 'lzw' }); break;
    default:
      pipe = q >= 100 ? pipe.png({ compressionLevel: 6 }) : pipe.png({ compressionLevel: 6, palette: true, quality: q });
      break;
  }

  const buf = await pipe.toBuffer();
  return buf.length;
}

/** Writes bytes straight to disk — used for SVG export and mask side-cars. */
async function writeBinary(outPath: string, data: Uint8Array): Promise<{ ok: boolean; size: number }> {
  await writeFile(outPath, Buffer.from(data));
  return { ok: true, size: data.byteLength };
}

export function registerImageHandlers(ipcMain: IpcMain) {
  ipcMain.handle('image:probe', (_e, filePath: string) => probeImage(filePath));
  ipcMain.handle('image:prepare', (_e, filePath: string) => prepareForDisplay(filePath));
  ipcMain.handle('image:encode', (_e, req: EncodeRequest) => encodeImage(req));
  ipcMain.handle('image:estimate', (_e, req: Omit<EncodeRequest, 'outPath'>) => estimateSize(req));
  ipcMain.handle('image:writeBinary', (_e, outPath: string, data: Uint8Array) =>
    writeBinary(outPath, data),
  );
  ipcMain.handle('image:baseName', (_e, filePath: string) =>
    basename(filePath, extname(filePath)),
  );
}
