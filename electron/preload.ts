import { contextBridge, ipcRenderer } from 'electron';
import type {
  DownloadProgress,
  EncodeRequest,
  ImageProbe,
  ModelStatus,
  ProjectDocument,
  ProjectMeta,
  SegmentResult,
} from '../src/types.js';

const api = {
  openImagesDialog: (): Promise<string[]> => ipcRenderer.invoke('dialog:openImages'),
  relinkImageDialog: (fileName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:relinkImage', fileName),
  saveFileDialog: (defaultName: string, ext: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveFile', defaultName, ext),
  pathExists: (filePath: string): Promise<boolean> => ipcRenderer.invoke('fs:exists', filePath),
  revealInFinder: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('shell:revealInFinder', filePath),

  image: {
    probe: (filePath: string): Promise<ImageProbe> => ipcRenderer.invoke('image:probe', filePath),
    prepare: (filePath: string): Promise<{ url: string; transcoded: boolean }> =>
      ipcRenderer.invoke('image:prepare', filePath),
    encode: (req: EncodeRequest): Promise<{ ok: boolean; path: string; size: number }> =>
      ipcRenderer.invoke('image:encode', req),
    estimate: (req: Omit<EncodeRequest, 'outPath'>): Promise<number> =>
      ipcRenderer.invoke('image:estimate', req),
    writeBinary: (outPath: string, data: Uint8Array): Promise<{ ok: boolean; size: number }> =>
      ipcRenderer.invoke('image:writeBinary', outPath, data),
    baseName: (filePath: string): Promise<string> => ipcRenderer.invoke('image:baseName', filePath),
  },

  svg: {
    read: (filePath: string): Promise<string> => ipcRenderer.invoke('svg:read', filePath),
    write: (filePath: string, source: string, optimize: boolean): Promise<{ ok: boolean; size: number }> =>
      ipcRenderer.invoke('svg:write', filePath, source, optimize),
    optimize: (source: string, aggressive: boolean): Promise<string> =>
      ipcRenderer.invoke('svg:optimize', source, aggressive),
  },

  segment: {
    models: (): Promise<(ModelStatus & { id: string })[]> => ipcRenderer.invoke('segment:models'),
    status: (id: string): Promise<ModelStatus> => ipcRenderer.invoke('segment:status', id),
    download: (id: string): Promise<ModelStatus> => ipcRenderer.invoke('segment:download', id),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('segment:remove', id),
    run: (id: string, width: number, height: number, rgba: Uint8Array): Promise<SegmentResult> =>
      ipcRenderer.invoke('segment:run', id, width, height, rgba),
    onDownloadProgress: (cb: (p: DownloadProgress) => void): (() => void) => {
      const listener = (_e: unknown, data: DownloadProgress) => cb(data);
      ipcRenderer.on('segment:downloadProgress', listener);
      return () => ipcRenderer.removeListener('segment:downloadProgress', listener);
    },
  },

  projects: {
    list: (): Promise<ProjectMeta[]> => ipcRenderer.invoke('projects:list'),
    create: (doc: ProjectDocument): Promise<ProjectDocument> =>
      ipcRenderer.invoke('projects:create', doc),
    load: (id: string): Promise<ProjectDocument> => ipcRenderer.invoke('projects:load', id),
    save: (doc: ProjectDocument, poster?: string): Promise<ProjectMeta> =>
      ipcRenderer.invoke('projects:save', doc, poster),
    rename: (id: string, name: string): Promise<ProjectMeta> =>
      ipcRenderer.invoke('projects:rename', id, name),
    duplicate: (id: string): Promise<ProjectMeta> => ipcRenderer.invoke('projects:duplicate', id),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('projects:delete', id),
    writeBlob: (id: string, name: string, data: Uint8Array): Promise<boolean> =>
      ipcRenderer.invoke('projects:writeBlob', id, name, data),
    readBlob: (id: string, name: string): Promise<Uint8Array | null> =>
      ipcRenderer.invoke('projects:readBlob', id, name),
    deleteBlob: (id: string, name: string): Promise<boolean> =>
      ipcRenderer.invoke('projects:deleteBlob', id, name),
  },

  // Main asks the renderer to flush the open project before the app quits.
  onFlushSave: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on('app:flushSave', listener);
    return () => ipcRenderer.removeListener('app:flushSave', listener);
  },
  flushSaveDone: (): void => {
    ipcRenderer.send('app:flushSaveDone');
  },
};

contextBridge.exposeInMainWorld('inj', api);

export type InjApi = typeof api;
