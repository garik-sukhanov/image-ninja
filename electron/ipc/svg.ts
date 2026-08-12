import type { IpcMain } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { optimize } from 'svgo';

/**
 * svgo's defaults are tuned for shipping a finished icon; an editor needs to be
 * more conservative, because the thing being optimised is still someone's
 * working file. Three defaults are turned off on purpose:
 *
 * - `cleanupIds` deletes ids it thinks are unused, but an id can be referenced
 *   from *outside* the file (sprite sheets, `<use href="#…">`, CSS, JS). A few
 *   saved bytes are not worth silently breaking that.
 * - `removeHiddenElems` would delete layers the user merely toggled off, which
 *   turns "hide a layer" into "lose a layer".
 * - `convertShapeToPath` rewrites rects and circles as paths, which loses the
 *   editable primitive the inspector works with.
 *
 * (`removeViewBox` is not part of preset-default in svgo 4 — viewBox already
 * survives without an override.)
 */
function optimizeSvg(source: string, aggressive: boolean): string {
  const result = optimize(source, {
    multipass: true,
    js2svg: { pretty: !aggressive, indent: 2 },
    plugins: [
      {
        name: 'preset-default',
        params: {
          overrides: {
            cleanupIds: false,
            removeHiddenElems: false,
            convertShapeToPath: false,
            mergePaths: aggressive ? { force: false } : false,
            collapseGroups: aggressive ? null : false,
            removeUnknownsAndDefaults: { keepDataAttrs: true },
          },
        },
      },
    ],
  });
  return result.data;
}

async function readSvg(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8');
}

async function writeSvg(filePath: string, source: string, optimizeFirst: boolean): Promise<{ ok: boolean; size: number }> {
  const out = optimizeFirst ? optimizeSvg(source, true) : source;
  await writeFile(filePath, out, 'utf8');
  return { ok: true, size: Buffer.byteLength(out, 'utf8') };
}

export function registerSvgHandlers(ipcMain: IpcMain) {
  ipcMain.handle('svg:read', (_e, filePath: string) => readSvg(filePath));
  ipcMain.handle('svg:write', (_e, filePath: string, source: string, opt: boolean) =>
    writeSvg(filePath, source, opt),
  );
  ipcMain.handle('svg:optimize', (_e, source: string, aggressive: boolean) =>
    optimizeSvg(source, aggressive),
  );
}
