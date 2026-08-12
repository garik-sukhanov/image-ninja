import { useState } from 'react';
import { SvgCanvas } from './SvgCanvas';
import { SvgToolbar } from './SvgToolbar';
import { LayersPanel } from './LayersPanel';
import { InspectorPanel } from './InspectorPanel';
import { PalettePanel } from './PalettePanel';
import { CodePanel } from './CodePanel';
import { Icon } from '../Icons';

export function SvgEditor() {
  const [showCode, setShowCode] = useState(false);

  return (
    <div className="flex h-full min-h-0">
      <SvgToolbar />

      <div className="w-56 border-r border-border bg-panel-2 shrink-0 min-h-0">
        <LayersPanel />
      </div>

      <div className="flex-1 min-w-0 relative">
        <SvgCanvas />
        <button
          onClick={() => setShowCode((v) => !v)}
          className={`absolute bottom-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[11px] backdrop-blur transition-colors ${
            showCode
              ? 'bg-accent/20 border-accent/40 text-accent'
              : 'bg-panel-2/90 border-border text-gray-400 hover:text-white'
          }`}
          title="Показать исходник SVG"
        >
          <Icon name="code" size={13} /> Код
        </button>
      </div>

      {showCode && (
        <div className="w-96 border-l border-border shrink-0 min-h-0">
          <CodePanel onClose={() => setShowCode(false)} />
        </div>
      )}

      <div className="w-72 border-l border-border bg-panel-2 overflow-y-auto shrink-0">
        <InspectorPanel />
        <PalettePanel />
      </div>
    </div>
  );
}
