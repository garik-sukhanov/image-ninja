import type {
  DownloadProgress,
  EncodeRequest,
  ImageProbe,
  ModelStatus,
  ProjectDocument,
  ProjectMeta,
  SegmentResult,
} from './types';

declare global {
  interface Window {
    inj: {
      openImagesDialog: () => Promise<string[]>;
      relinkImageDialog: (fileName: string) => Promise<string | null>;
      saveFileDialog: (defaultName: string, ext: string) => Promise<string | null>;
      pathExists: (filePath: string) => Promise<boolean>;
      revealInFinder: (filePath: string) => Promise<boolean>;

      image: {
        probe: (filePath: string) => Promise<ImageProbe>;
        prepare: (filePath: string) => Promise<{ url: string; transcoded: boolean }>;
        encode: (req: EncodeRequest) => Promise<{ ok: boolean; path: string; size: number }>;
        estimate: (req: Omit<EncodeRequest, 'outPath'>) => Promise<number>;
        writeBinary: (outPath: string, data: Uint8Array) => Promise<{ ok: boolean; size: number }>;
        baseName: (filePath: string) => Promise<string>;
      };

      svg: {
        read: (filePath: string) => Promise<string>;
        write: (filePath: string, source: string, optimize: boolean) => Promise<{ ok: boolean; size: number }>;
        optimize: (source: string, aggressive: boolean) => Promise<string>;
      };

      segment: {
        models: () => Promise<(ModelStatus & { id: string })[]>;
        status: (id: string) => Promise<ModelStatus>;
        download: (id: string) => Promise<ModelStatus>;
        remove: (id: string) => Promise<boolean>;
        run: (id: string, width: number, height: number, rgba: Uint8Array) => Promise<SegmentResult>;
        onDownloadProgress: (cb: (p: DownloadProgress) => void) => () => void;
      };

      projects: {
        list: () => Promise<ProjectMeta[]>;
        create: (doc: ProjectDocument) => Promise<ProjectDocument>;
        load: (id: string) => Promise<ProjectDocument>;
        save: (doc: ProjectDocument, poster?: string) => Promise<ProjectMeta>;
        rename: (id: string, name: string) => Promise<ProjectMeta>;
        duplicate: (id: string) => Promise<ProjectMeta>;
        remove: (id: string) => Promise<boolean>;
        writeBlob: (id: string, name: string, data: Uint8Array) => Promise<boolean>;
        readBlob: (id: string, name: string) => Promise<Uint8Array | null>;
        deleteBlob: (id: string, name: string) => Promise<boolean>;
      };

      onFlushSave: (cb: () => void) => () => void;
      flushSaveDone: () => void;
    };
  }
}

export {};
