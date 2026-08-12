import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../appStore';
import { createBlankSvg, createProjectsFromFiles, openProject } from '../projectIO';
import type { ProjectMeta } from '../types';
import { Icon } from './Icons';

const IMAGE_RE = /\.(png|jpe?g|webp|avif|gif|bmp|tiff?|heic|heif|svg)$/i;

export function ProjectsScreen() {
  const revision = useAppStore((s) => s.projectsRevision);
  const bump = useAppStore((s) => s.bumpProjects);
  const showToast = useAppStore((s) => s.showToast);

  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'raster' | 'svg'>('all');
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    window.inj.projects
      .list()
      .then((list) => { if (alive) setProjects(list); })
      .catch(() => showToast('Не удалось прочитать список проектов', 'error'))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [revision, showToast]);

  const importFiles = useCallback(
    async (paths: string[]) => {
      const valid = paths.filter((p) => IMAGE_RE.test(p));
      if (valid.length === 0) {
        showToast('Нет поддерживаемых файлов', 'error');
        return;
      }
      try {
        const lastId = await createProjectsFromFiles(valid);
        if (valid.length === 1 && lastId) await openProject(lastId);
      } catch (e) {
        console.error(e);
        showToast(e instanceof Error ? e.message : 'Ошибка импорта', 'error');
      }
    },
    [showToast],
  );

  const visible = projects.filter(
    (p) =>
      (filter === 'all' || p.kind === filter) &&
      (!query || p.name.toLowerCase().includes(query.toLowerCase())),
  );

  return (
    <div
      className="h-screen w-screen bg-panel text-white flex flex-col"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const paths = Array.from(e.dataTransfer.files)
          .map((f) => (f as File & { path?: string }).path)
          .filter((p): p is string => Boolean(p));
        if (paths.length) void importFiles(paths);
      }}
    >
      <div className="titlebar-drag h-11 shrink-0 border-b border-border flex items-center px-4">
        <div className="absolute left-20 flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-accent/15 flex items-center justify-center">
            <span className="text-accent text-[10px] font-bold">IN</span>
          </div>
          <span className="text-xs font-medium text-gray-300">Image Ninja</span>
        </div>
      </div>

      <div className="px-8 pt-6 pb-4 flex items-center gap-3 shrink-0">
        <h1 className="text-lg font-semibold">Проекты</h1>
        <span className="text-xs text-gray-600">{projects.length}</span>
        <div className="flex-1" />

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск…"
          className="bg-panel-2 border border-border rounded px-2.5 py-1.5 text-xs w-44 outline-none focus:border-accent transition-colors"
        />

        <div className="flex bg-panel-2 rounded-md p-0.5 gap-0.5 border border-border">
          {([['all', 'Все'], ['raster', 'Растр'], ['svg', 'SVG']] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`text-[11px] px-2.5 py-1 rounded transition-colors ${
                filter === value ? 'bg-accent/20 text-accent' : 'text-gray-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          onClick={async () => {
            const id = await createBlankSvg();
            await openProject(id);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-panel-3 hover:bg-panel-4 text-xs transition-colors"
          title="Создать пустой SVG-холст"
        >
          <Icon name="plus" size={13} /> Новый SVG
        </button>

        <button
          onClick={async () => {
            const paths = await window.inj.openImagesDialog();
            if (paths.length) await importFiles(paths);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent hover:bg-accent/85 text-black text-xs font-medium transition-colors"
        >
          <Icon name="folder" size={13} /> Открыть файлы
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8 min-h-0">
        {loading ? (
          <p className="text-xs text-gray-600 py-12 text-center">Загрузка…</p>
        ) : visible.length === 0 ? (
          <EmptyState hasProjects={projects.length > 0} onOpen={async () => {
            const paths = await window.inj.openImagesDialog();
            if (paths.length) await importFiles(paths);
          }} />
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {visible.map((project) => (
              <div
                key={project.id}
                className="group bg-panel-2 border border-border rounded-lg overflow-hidden hover:border-accent/50 transition-colors cursor-pointer"
                onDoubleClick={() => void openProject(project.id)}
              >
                <div
                  className="aspect-[4/3] checkerboard flex items-center justify-center relative"
                  onClick={() => void openProject(project.id)}
                >
                  {project.poster ? (
                    <img src={project.poster} alt="" className="max-w-full max-h-full object-contain" />
                  ) : (
                    <Icon name={project.kind === 'svg' ? 'pen' : 'image'} size={28} className="text-gray-600" />
                  )}
                  <span
                    className={`absolute top-1.5 left-1.5 text-[8px] px-1.5 py-0.5 rounded font-bold ${
                      project.kind === 'svg' ? 'bg-accent-2/80 text-black' : 'bg-accent/80 text-black'
                    }`}
                  >
                    {project.kind === 'svg' ? 'SVG' : 'IMG'}
                  </span>
                </div>

                <div className="p-2.5">
                  {renaming === project.id ? (
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={async () => {
                        await window.inj.projects.rename(project.id, renameDraft);
                        setRenaming(null);
                        bump();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      className="w-full bg-panel-3 border border-accent rounded px-1.5 py-0.5 text-xs outline-none"
                    />
                  ) : (
                    <p className="text-xs font-medium truncate" title={project.name}>{project.name}</p>
                  )}
                  <p className="text-[10px] text-gray-600 mt-0.5">
                    {project.width}×{project.height} · {formatDate(project.updatedAt)}
                  </p>

                  <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <CardAction title="Переименовать" onClick={() => { setRenaming(project.id); setRenameDraft(project.name); }}>
                      <Icon name="text" size={12} />
                    </CardAction>
                    <CardAction title="Дублировать" onClick={async () => { await window.inj.projects.duplicate(project.id); bump(); }}>
                      <Icon name="group" size={12} />
                    </CardAction>
                    <div className="flex-1" />
                    <CardAction
                      title="Удалить"
                      danger
                      onClick={async () => {
                        if (!confirm(`Удалить проект «${project.name}»?`)) return;
                        await window.inj.projects.remove(project.id);
                        bump();
                      }}
                    >
                      <Icon name="trash" size={12} />
                    </CardAction>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {dragging && (
        <div className="fixed inset-0 bg-accent/10 border-2 border-dashed border-accent pointer-events-none flex items-center justify-center">
          <p className="text-sm text-accent font-medium">Отпустите, чтобы импортировать</p>
        </div>
      )}
    </div>
  );
}

function CardAction({
  children, onClick, title, danger,
}: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={title}
      className={`p-1 rounded transition-colors ${
        danger ? 'text-gray-500 hover:text-red-400 hover:bg-red-500/10' : 'text-gray-500 hover:text-white hover:bg-panel-3'
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState({ hasProjects, onOpen }: { hasProjects: boolean; onOpen: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Icon name="image" size={40} className="text-gray-700 mb-4" />
      <p className="text-sm text-gray-400 mb-1">
        {hasProjects ? 'Ничего не найдено' : 'Пока нет проектов'}
      </p>
      <p className="text-xs text-gray-600 mb-5">
        Перетащите изображения или SVG в окно — или откройте их через диалог
      </p>
      {!hasProjects && (
        <button
          onClick={onOpen}
          className="px-4 py-2 rounded bg-accent text-black text-xs font-medium hover:bg-accent/85 transition-colors"
        >
          Открыть файлы
        </button>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}
