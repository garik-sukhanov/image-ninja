import { useMemo, useState } from 'react';
import { useSvgStore, documentPalette } from '../../svg/svgStore';
import { useAppStore } from '../../appStore';
import { Button, Section, normalizeHex } from '../ui';

/**
 * Every literal colour in the document, with a one-click "replace everywhere".
 * This is the fastest way to re-theme an icon set someone handed you — the
 * usual pain point when a downloaded SVG is the wrong brand colour.
 */
export function PalettePanel() {
  const nodes = useSvgStore((s) => s.nodes);
  const defs = useSvgStore((s) => s.defs);
  const selection = useSvgStore((s) => s.selection);
  const replaceColor = useSvgStore((s) => s.replaceColor);
  const updateManyAttrs = useSvgStore((s) => s.updateManyAttrs);
  const pushHistory = useSvgStore((s) => s.pushHistory);
  const showToast = useAppStore((s) => s.showToast);

  const palette = useMemo(() => documentPalette(nodes, defs), [nodes, defs]);
  const [picked, setPicked] = useState<string | null>(null);
  const [replacement, setReplacement] = useState('#000000');

  const select = (color: string) => {
    setPicked(color);
    setReplacement(normalizeHex(color));
  };

  return (
    <Section title="Цвета документа" right={<span className="text-[10px] text-gray-600">{palette.length}</span>}>
      {palette.length === 0 ? (
        <p className="text-[10px] text-gray-600">Литеральных цветов нет</p>
      ) : (
        <div className="grid grid-cols-8 gap-1">
          {palette.map(({ color, count }) => (
            <button
              key={color}
              onClick={() => select(color)}
              title={`${color} · ${count} шт.`}
              className={`aspect-square rounded border transition-all ${
                picked === color ? 'border-accent scale-110' : 'border-border hover:border-gray-500'
              }`}
              style={{ background: color }}
            />
          ))}
        </div>
      )}

      {picked && (
        <div className="mt-3 p-2 bg-panel-3 rounded">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-5 h-5 rounded border border-border shrink-0" style={{ background: picked }} />
            <span className="text-[10px] text-gray-500">→</span>
            <div className="relative w-5 h-5 rounded border border-border overflow-hidden shrink-0">
              <div className="absolute inset-0" style={{ background: replacement }} />
              <input
                type="color"
                value={normalizeHex(replacement)}
                onChange={(e) => setReplacement(e.target.value)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </div>
            <input
              type="text"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              className="num-input flex-1 min-w-0"
              spellCheck={false}
            />
          </div>

          <div className="flex gap-1.5">
            <Button
              variant="accent"
              className="flex-1"
              onClick={() => {
                const hits = replaceColor(picked, replacement);
                showToast(hits > 0 ? `Заменено в ${hits} местах` : 'Совпадений не найдено', hits > 0 ? 'ok' : 'error');
                setPicked(null);
              }}
            >
              Заменить везде
            </Button>
            <Button onClick={() => setPicked(null)}>Отмена</Button>
          </div>

          {selection.length > 0 && (
            <div className="flex gap-1.5 mt-1.5">
              <Button
                className="flex-1"
                onClick={() => { pushHistory(); updateManyAttrs(selection, { fill: replacement }); }}
              >
                В заливку
              </Button>
              <Button
                className="flex-1"
                onClick={() => { pushHistory(); updateManyAttrs(selection, { stroke: replacement }); }}
              >
                В обводку
              </Button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
