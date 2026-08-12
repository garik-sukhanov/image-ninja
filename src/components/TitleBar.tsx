import { useEffect, useState } from 'react';
import { useAppStore } from '../appStore';
import { useRasterStore } from '../raster/rasterStore';
import { useSvgStore } from '../svg/svgStore';
import { closeToProjects, saveCurrentProject } from '../projectIO';
import { Icon } from './Icons';

export function TitleBar() {
  const current = useAppStore((s) => s.current);
  const dirty = useAppStore((s) => s.dirty);
  const saving = useAppStore((s) => s.saving);
  const toast = useAppStore((s) => s.toast);
  const setExportOpen = useAppStore((s) => s.setExportOpen);
  const setName = useAppStore((s) => s.setName);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current?.name ?? '');

  useEffect(() => setDraft(current?.name ?? ''), [current?.name]);

  const isSvg = current?.kind === 'svg';
  const status = saving ? 'Сохранение…' : dirty ? '• не сохранено' : 'Сохранено';

  const undo = isSvg ? useSvgStore.getState().undo : useRasterStore.getState().undo;
  const redo = isSvg ? useSvgStore.getState().redo : useRasterStore.getState().redo;
  const canUndo = useUndoState(isSvg, 'past');
  const canRedo = useUndoState(isSvg, 'future');

  return (
    <div className="titlebar-drag h-10 flex items-center border-b border-border bg-panel relative px-4 shrink-0">
      <div className="absolute left-20 no-drag flex items-center gap-2">
        <button
          onClick={() => void closeToProjects()}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-panel-3 transition-colors"
          title="К списку проектов (с сохранением)"
        >
          <span className="text-sm leading-none">‹</span> Проекты
        </button>
        <div className="w-px h-4 bg-border" />
        <button
          onClick={undo}
          disabled={!canUndo}
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-panel-3 disabled:opacity-25 transition-colors"
          title="Отменить (Cmd+Z)"
        >
          <Icon name="undo" size={14} />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-panel-3 disabled:opacity-25 transition-colors"
          title="Повторить (Cmd+Shift+Z)"
        >
          <Icon name="redo" size={14} />
        </button>
      </div>

      <div className="flex-1 text-center text-xs flex items-center justify-center gap-2 min-w-0">
        <span
          className={`no-drag text-[9px] px-1.5 py-0.5 rounded font-medium ${
            isSvg ? 'bg-accent-2/15 text-accent-2' : 'bg-accent/15 text-accent'
          }`}
        >
          {isSvg ? 'SVG' : 'RASTER'}
        </span>
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { setEditing(false); setName(draft.trim() || 'Без названия'); void saveCurrentProject(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') { setDraft(current?.name ?? ''); setEditing(false); }
            }}
            className="no-drag bg-panel-3 border border-accent rounded px-2 py-0.5 text-xs text-white outline-none w-56"
          />
        ) : (
          <button
            onDoubleClick={() => setEditing(true)}
            className="no-drag text-gray-300 font-medium truncate max-w-[280px] hover:text-white"
            title="Двойной клик — переименовать"
          >
            {current?.name ?? 'Без названия'}
          </button>
        )}
        <button
          onClick={() => void saveCurrentProject()}
          className={`no-drag text-[10px] px-1.5 py-0.5 rounded transition-colors ${
            dirty && !saving ? 'text-accent-2 hover:bg-panel-3' : 'text-gray-600 cursor-default'
          }`}
          title="Сохранить (Cmd+S)"
        >
          {status}
        </button>
      </div>

      <div className="no-drag flex items-center gap-2">
        {toast && (
          <span
            className={`text-[10px] px-2 py-1 rounded ${
              toast.kind === 'error' ? 'bg-red-500/15 text-red-300' : 'bg-accent/15 text-accent'
            }`}
          >
            {toast.text}
          </span>
        )}
        <button
          onClick={() => setExportOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-accent hover:bg-accent/85 text-black font-medium transition-colors"
          title="Экспортировать (Cmd+E)"
        >
          <Icon name="download" size={13} /> Экспорт
        </button>
      </div>
    </div>
  );
}

/** Subscribes to whichever editor store is active so the buttons stay live. */
function useUndoState(isSvg: boolean, key: 'past' | 'future'): boolean {
  const svgLen = useSvgStore((s) => s[key].length);
  const rasterLen = useRasterStore((s) => s[key].length);
  return (isSvg ? svgLen : rasterLen) > 0;
}
