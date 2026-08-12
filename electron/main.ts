import { app, BrowserWindow, ipcMain, dialog, shell, protocol } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { registerImageHandlers } from './ipc/image.js';
import { registerSvgHandlers } from './ipc/svg.js';
import { registerProjectHandlers } from './ipc/projects.js';
import { registerSegmentHandlers } from './ipc/segment.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'imgfile',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

let mainWindow: BrowserWindow | null = null;

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

export const IMAGE_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif',
];

function mimeFor(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/** Serves files from disk to the renderer without disabling web security. */
async function serveLocalFile(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const filePath = decodeURIComponent(url.pathname);

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return new Response('Not Found', { status: 404 });
  }

  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': mimeFor(filePath),
      'Content-Length': String(fileStat.size),
      'Cache-Control': 'no-cache',
    },
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#16171c',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  protocol.handle('imgfile', serveLocalFile);

  registerIpc();
  registerImageHandlers(ipcMain);
  registerSvgHandlers(ipcMain);
  registerProjectHandlers(ipcMain);
  registerSegmentHandlers(ipcMain, () => mainWindow);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Give the renderer a chance to flush the open project to disk before we quit.
let flushing = false;
app.on('before-quit', (e) => {
  if (flushing || !mainWindow || mainWindow.isDestroyed()) return;
  e.preventDefault();
  flushing = true;
  const done = () => app.quit();
  ipcMain.once('app:flushSaveDone', done);
  mainWindow.webContents.send('app:flushSave');
  // Safety net: never hang the quit on a stuck renderer.
  setTimeout(done, 1500);
});

function registerIpc() {
  ipcMain.handle('shell:revealInFinder', async (_e, filePath: string) => {
    shell.showItemInFolder(filePath);
    return true;
  });

  ipcMain.handle('dialog:openImages', async () => {
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Открыть изображения',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Изображения и SVG', extensions: [...IMAGE_EXTENSIONS, 'svg'] },
        { name: 'Растровые изображения', extensions: IMAGE_EXTENSIONS },
        { name: 'SVG', extensions: ['svg'] },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('dialog:relinkImage', async (_e, fileName: string) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Найти файл: ${fileName}`,
      properties: ['openFile'],
      filters: [
        { name: 'Изображения и SVG', extensions: [...IMAGE_EXTENSIONS, 'svg'] },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:saveFile', async (_e, defaultName: string, ext: string) => {
    if (!mainWindow) return null;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Экспорт',
      defaultPath: defaultName,
      filters: [
        { name: ext.toUpperCase(), extensions: [ext] },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('fs:exists', async (_e, filePath: string) => {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  });
}
