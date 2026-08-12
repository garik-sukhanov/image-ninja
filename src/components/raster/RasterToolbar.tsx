import { useEffect } from 'react';
import { useRasterStore, type RasterTool } from '../../raster/rasterStore';
import { Icon, type IconName } from '../Icons';
import { ToolButton } from '../ui';

const TOOLS: { tool: RasterTool; icon: IconName; title: string; key: string }[] = [
  { tool: 'move', icon: 'cursor', title: 'Перемещение и зум', key: 'V' },
  { tool: 'crop', icon: 'crop', title: 'Обрезка', key: 'C' },
  { tool: 'wand', icon: 'wand', title: 'Волшебная палочка — удалить фон по клику', key: 'W' },
  { tool: 'eraser', icon: 'eraser', title: 'Ластик — стирать вручную', key: 'E' },
  { tool: 'restore', icon: 'brush', title: 'Восстановление — вернуть стёртое', key: 'R' },
  { tool: 'picker', icon: 'picker', title: 'Пипетка — скопировать цвет', key: 'I' },
];

export function RasterToolbar() {
  const tool = useRasterStore((s) => s.tool);
  const setTool = useRasterStore((s) => s.setTool);
  const applyCropDraft = useRasterStore((s) => s.applyCropDraft);
  const cropDraft = useRasterStore((s) => s.cropDraft);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey) return;
      const hit = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
      if (hit) {
        e.preventDefault();
        setTool(hit.tool);
      }
      if (e.key === 'Enter' && useRasterStore.getState().tool === 'crop') {
        e.preventDefault();
        applyCropDraft();
      }
      if (e.key === 'Escape') useRasterStore.getState().setCropDraft(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTool, applyCropDraft]);

  return (
    <div className="w-12 border-r border-border bg-panel-2 flex flex-col items-center py-2 gap-0.5 shrink-0">
      {TOOLS.map((t) => (
        <ToolButton
          key={t.tool}
          active={tool === t.tool}
          onClick={() => setTool(t.tool)}
          title={`${t.title} (${t.key})`}
        >
          <Icon name={t.icon} />
        </ToolButton>
      ))}

      {tool === 'crop' && (
        <>
          <div className="w-6 h-px bg-border my-1.5" />
          <ToolButton
            active
            onClick={applyCropDraft}
            title="Применить обрезку (Enter)"
            disabled={!cropDraft || cropDraft.width < 1}
          >
            <Icon name="check" />
          </ToolButton>
        </>
      )}
    </div>
  );
}
