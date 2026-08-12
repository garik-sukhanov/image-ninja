import { create } from 'zustand';
import type { ProjectKind, ProjectMeta } from './types';

export type AppView = 'projects' | 'editor';

/** Identity of the open project. The document itself lives in the editor
 *  stores (rasterStore / svgStore) so those stay focused on their own model. */
export interface OpenProject {
  id: string;
  kind: ProjectKind;
  name: string;
  createdAt: string;
}

interface AppShellState {
  view: AppView;
  current: OpenProject | null;
  /** Unsaved changes since the last successful write. */
  dirty: boolean;
  saving: boolean;
  lastSavedAt: string | null;
  /** Bumped whenever the projects list changes so the screen can refetch. */
  projectsRevision: number;
  exportOpen: boolean;
  /** Transient toast shown in the title bar. */
  toast: { text: string; kind: 'ok' | 'error' } | null;

  setView: (view: AppView) => void;
  setCurrent: (project: OpenProject | null) => void;
  setName: (name: string) => void;
  markDirty: () => void;
  setSaving: (saving: boolean) => void;
  markSaved: (at: string) => void;
  bumpProjects: () => void;
  setExportOpen: (open: boolean) => void;
  showToast: (text: string, kind?: 'ok' | 'error') => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useAppStore = create<AppShellState>((set) => ({
  view: 'projects',
  current: null,
  dirty: false,
  saving: false,
  lastSavedAt: null,
  projectsRevision: 0,
  exportOpen: false,
  toast: null,

  setView: (view) => set({ view }),
  setCurrent: (current) =>
    set({ current, dirty: false, lastSavedAt: current ? new Date().toISOString() : null }),
  setName: (name) => set((s) => (s.current ? { current: { ...s.current, name } } : {})),
  markDirty: () => set({ dirty: true }),
  setSaving: (saving) => set({ saving }),
  markSaved: (at) => set({ dirty: false, saving: false, lastSavedAt: at }),
  bumpProjects: () => set((s) => ({ projectsRevision: s.projectsRevision + 1 })),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  showToast: (text, kind = 'ok') => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { text, kind } });
    toastTimer = setTimeout(() => set({ toast: null }), 3200);
  },
}));

export function metaToOpen(
  meta: Pick<ProjectMeta, 'id' | 'kind' | 'name' | 'createdAt'>,
): OpenProject {
  return { id: meta.id, kind: meta.kind, name: meta.name, createdAt: meta.createdAt };
}
