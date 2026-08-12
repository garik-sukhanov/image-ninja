import { useEffect } from 'react';
import { useSvgStore, type SvgTool } from '../../svg/svgStore';
import { Icon, type IconName } from '../Icons';
import { ToolButton } from '../ui';

const TOOLS: { tool: SvgTool; icon: IconName; title: string; key: string }[] = [
  { tool: 'select', icon: 'cursor', title: 'Выделение и трансформация', key: 'V' },
  { tool: 'node', icon: 'node', title: 'Узлы — таскать точки и безье-ручки', key: 'A' },
  { tool: 'pen', icon: 'pen', title: 'Перо — строить контур по точкам', key: 'P' },
  { tool: 'pencil', icon: 'pencil', title: 'Карандаш — рисование от руки', key: 'B' },
  { tool: 'rect', icon: 'rect', title: 'Прямоугольник', key: 'R' },
  { tool: 'ellipse', icon: 'ellipse', title: 'Эллипс', key: 'O' },
  { tool: 'line', icon: 'line', title: 'Линия', key: 'L' },
  { tool: 'polygon', icon: 'polygon', title: 'Многоугольник', key: 'G' },
  { tool: 'star', icon: 'star', title: 'Звезда', key: 'S' },
  { tool: 'text', icon: 'text', title: 'Текст', key: 'T' },
  { tool: 'pan', icon: 'hand', title: 'Панорама', key: 'H' },
];

export function SvgToolbar() {
  const tool = useSvgStore((s) => s.tool);
  const setTool = useSvgStore((s) => s.setTool);
  const showGrid = useSvgStore((s) => s.showGrid);
  const snapToObjects = useSvgStore((s) => s.snapToObjects);
  const toggleFlag = useSvgStore((s) => s.toggleFlag);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || e.metaKey || e.ctrlKey) return;
      const hit = TOOLS.find((t) => t.key.toLowerCase() === e.key.toLowerCase());
      if (hit) {
        e.preventDefault();
        setTool(hit.tool);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTool]);

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

      <div className="w-6 h-px bg-border my-1.5" />

      <ToolButton active={showGrid} onClick={() => toggleFlag('showGrid')} title="Сетка">
        <Icon name="grid" />
      </ToolButton>
      <ToolButton
        active={snapToObjects}
        onClick={() => toggleFlag('snapToObjects')}
        title="Привязка к объектам (Alt при перетаскивании — отключить)"
      >
        <Icon name="magnet" />
      </ToolButton>
    </div>
  );
}
