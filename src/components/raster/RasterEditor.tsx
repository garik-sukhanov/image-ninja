import { useEffect } from 'react';
import { useRasterStore } from '../../raster/rasterStore';
import { RasterCanvas } from './RasterCanvas';
import { RasterToolbar } from './RasterToolbar';
import { TransformPanel } from './TransformPanel';
import { AdjustPanel } from './AdjustPanel';
import { AlphaPanel } from './AlphaPanel';

export function RasterEditor() {
  const busy = useRasterStore((s) => s.busy);

  // Editor-wide shortcuts that aren't tool switches.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      const s = useRasterStore.getState();

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (e.key === '[') { e.preventDefault(); s.setBrush({ brushSize: Math.max(2, s.brushSize / 1.25) }); }
      if (e.key === ']') { e.preventDefault(); s.setBrush({ brushSize: Math.min(600, s.brushSize * 1.25) }); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full min-h-0">
      <RasterToolbar />
      <div className="flex-1 min-w-0 relative">
        <RasterCanvas />
        {busy && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center pointer-events-none">
            <div className="bg-panel-2 border border-border rounded-lg px-4 py-3 text-xs text-gray-200">
              {busy}
            </div>
          </div>
        )}
      </div>
      <div className="w-72 border-l border-border bg-panel-2 overflow-y-auto shrink-0">
        <TransformPanel />
        <AlphaPanel />
        <AdjustPanel />
      </div>
    </div>
  );
}
