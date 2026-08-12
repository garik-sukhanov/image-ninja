import type { IpcMain } from 'electron';
import { app } from 'electron';
import { mkdir, readFile, writeFile, readdir, rm, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectDocument, ProjectMeta } from '../../src/types.js';

function projectsRoot(): string {
  return join(app.getPath('userData'), 'Projects');
}

function projectDir(id: string): string {
  return join(projectsRoot(), id);
}

async function ensureRoot(): Promise<void> {
  await mkdir(projectsRoot(), { recursive: true });
}

function makeProjectId(): string {
  // time-prefixed so the on-disk folder order roughly matches creation order
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function deriveMeta(doc: ProjectDocument, poster?: string): ProjectMeta {
  const size =
    doc.kind === 'svg'
      ? { width: doc.canvas.width, height: doc.canvas.height }
      : {
          width: doc.crop?.width ?? doc.source.width,
          height: doc.crop?.height ?? doc.source.height,
        };
  return {
    id: doc.id,
    kind: doc.kind,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    poster,
    width: Math.round(size.width),
    height: Math.round(size.height),
    sourceName: doc.kind === 'raster' ? doc.source.fileName : doc.sourcePath,
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function listProjects(): Promise<ProjectMeta[]> {
  await ensureRoot();
  const entries = await readdir(projectsRoot(), { withFileTypes: true });
  const metas: ProjectMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = join(projectDir(entry.name), 'meta.json');
    try {
      if (existsSync(metaPath)) {
        metas.push(await readJson<ProjectMeta>(metaPath));
        continue;
      }
      // Fall back to deriving meta from the document if meta.json is missing.
      const docPath = join(projectDir(entry.name), 'project.json');
      if (existsSync(docPath)) {
        metas.push(deriveMeta(await readJson<ProjectDocument>(docPath)));
      }
    } catch (e) {
      console.warn('skipping unreadable project', entry.name, e);
    }
  }
  metas.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return metas;
}

async function createProject(doc: ProjectDocument): Promise<ProjectDocument> {
  await ensureRoot();
  const id = makeProjectId();
  const now = new Date().toISOString();
  const created: ProjectDocument = { ...doc, id, createdAt: now, updatedAt: now };
  await mkdir(projectDir(id), { recursive: true });
  await writeJson(join(projectDir(id), 'project.json'), created);
  await writeJson(join(projectDir(id), 'meta.json'), deriveMeta(created));
  return created;
}

async function loadProject(id: string): Promise<ProjectDocument> {
  return readJson<ProjectDocument>(join(projectDir(id), 'project.json'));
}

async function saveProject(doc: ProjectDocument, poster?: string): Promise<ProjectMeta> {
  const dir = projectDir(doc.id);
  await mkdir(dir, { recursive: true });
  const toWrite: ProjectDocument = { ...doc, updatedAt: new Date().toISOString() };
  await writeJson(join(dir, 'project.json'), toWrite);
  const meta = deriveMeta(toWrite, poster);
  await writeJson(join(dir, 'meta.json'), meta);
  return meta;
}

async function existingPoster(id: string): Promise<string | undefined> {
  const metaPath = join(projectDir(id), 'meta.json');
  if (!existsSync(metaPath)) return undefined;
  return (await readJson<ProjectMeta>(metaPath)).poster;
}

async function renameProject(id: string, name: string): Promise<ProjectMeta> {
  const doc = await loadProject(id);
  doc.name = name.trim() || doc.name;
  return saveProject(doc, await existingPoster(id));
}

async function duplicateProject(id: string): Promise<ProjectMeta> {
  const doc = await loadProject(id);
  const newId = makeProjectId();
  const now = new Date().toISOString();
  const copy: ProjectDocument = {
    ...doc,
    id: newId,
    name: `${doc.name} (копия)`,
    createdAt: now,
    updatedAt: now,
  };
  await mkdir(projectDir(newId), { recursive: true });
  await writeJson(join(projectDir(newId), 'project.json'), copy);

  // Carry over side-car blobs (the alpha mask) so the copy is a real copy.
  const srcMask = join(projectDir(id), 'mask.png');
  if (existsSync(srcMask)) {
    await writeFile(join(projectDir(newId), 'mask.png'), await readFile(srcMask));
  }

  const meta = deriveMeta(copy, await existingPoster(id));
  await writeJson(join(projectDir(newId), 'meta.json'), meta);
  return meta;
}

async function deleteProject(id: string): Promise<boolean> {
  const dir = projectDir(id);
  if (!existsSync(dir)) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}

/**
 * Side-car binaries (currently just the alpha mask). Kept out of project.json
 * so the document stays small and diff-able.
 */
async function writeBlob(id: string, name: string, data: Uint8Array): Promise<boolean> {
  const dir = projectDir(id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), Buffer.from(data));
  return true;
}

async function readBlob(id: string, name: string): Promise<Uint8Array | null> {
  const path = join(projectDir(id), name);
  if (!existsSync(path)) return null;
  return new Uint8Array(await readFile(path));
}

async function deleteBlob(id: string, name: string): Promise<boolean> {
  const path = join(projectDir(id), name);
  if (!existsSync(path)) return false;
  await unlink(path);
  return true;
}

export function registerProjectHandlers(ipcMain: IpcMain) {
  ipcMain.handle('projects:list', () => listProjects());
  ipcMain.handle('projects:create', (_e, doc: ProjectDocument) => createProject(doc));
  ipcMain.handle('projects:load', (_e, id: string) => loadProject(id));
  ipcMain.handle('projects:save', (_e, doc: ProjectDocument, poster?: string) =>
    saveProject(doc, poster),
  );
  ipcMain.handle('projects:rename', (_e, id: string, name: string) => renameProject(id, name));
  ipcMain.handle('projects:duplicate', (_e, id: string) => duplicateProject(id));
  ipcMain.handle('projects:delete', (_e, id: string) => deleteProject(id));
  ipcMain.handle('projects:writeBlob', (_e, id: string, name: string, data: Uint8Array) =>
    writeBlob(id, name, data),
  );
  ipcMain.handle('projects:readBlob', (_e, id: string, name: string) => readBlob(id, name));
  ipcMain.handle('projects:deleteBlob', (_e, id: string, name: string) => deleteBlob(id, name));
}
