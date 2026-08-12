import { useEffect, useMemo, useState } from 'react';
import { useSvgStore } from '../../svg/svgStore';
import { useAppStore } from '../../appStore';
import { buildDocument } from '../../projectIO';
import { serializeSvg } from '../../svg/serialize';
import { parseSvg } from '../../svg/parse';
import { Button } from '../ui';

/**
 * Live view of the file the editor would write. Editing here and pressing
 * "Применить" re-parses the document — useful for the surgical fixes that are
 * faster to type than to click, and for pasting an SVG in wholesale.
 */
export function CodePanel({ onClose }: { onClose: () => void }) {
  const nodes = useSvgStore((s) => s.nodes);
  const order = useSvgStore((s) => s.order);
  const defs = useSvgStore((s) => s.defs);
  const canvas = useSvgStore((s) => s.canvas);
  const replaceContent = useSvgStore((s) => s.replaceContent);
  const showToast = useAppStore((s) => s.showToast);

  const generated = useMemo(() => {
    const doc = buildDocument();
    if (!doc || doc.kind !== 'svg') return '';
    return serializeSvg(doc);
    // Regenerate whenever anything that ends up in the file changes.
  }, [nodes, order, defs, canvas]);

  const [draft, setDraft] = useState(generated);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  // Keep mirroring the document until the user starts typing.
  useEffect(() => {
    if (!dirty) setDraft(generated);
  }, [generated, dirty]);

  const apply = () => {
    try {
      const parsed = parseSvg(draft);
      replaceContent(parsed);
      setDirty(false);
      showToast('Код применён');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось разобрать SVG', 'error');
    }
  };

  const optimize = async () => {
    setBusy(true);
    try {
      const optimized = await window.inj.svg.optimize(draft, true);
      const before = draft.length;
      setDraft(optimized);
      setDirty(true);
      const saved = Math.max(0, Math.round((1 - optimized.length / before) * 100));
      showToast(`svgo: −${saved}% · нажмите «Применить»`);
    } catch {
      showToast('Не удалось оптимизировать', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-panel-2">
      <div className="flex items-center gap-1.5 px-3 h-9 border-b border-border shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-gray-400 flex-1">
          Исходник {dirty && <span className="text-accent-2">· изменён</span>}
        </span>
        <span className="text-[10px] text-gray-600 font-mono">{formatBytes(draft.length)}</span>
        <button onClick={onClose} className="text-gray-500 hover:text-white text-xs ml-1" title="Закрыть">
          ✕
        </button>
      </div>

      <textarea
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
        spellCheck={false}
        className="flex-1 min-h-0 bg-[#101116] text-gray-300 font-mono text-[11px] leading-relaxed p-3 outline-none resize-none"
      />

      <div className="flex gap-1.5 p-2 border-t border-border shrink-0">
        <Button variant="accent" onClick={apply} disabled={!dirty} className="flex-1">
          Применить
        </Button>
        <Button onClick={optimize} disabled={busy}>{busy ? '…' : 'svgo'}</Button>
        <Button onClick={() => { void navigator.clipboard.writeText(draft); showToast('Скопировано'); }}>
          Копировать
        </Button>
        {dirty && <Button onClick={() => { setDraft(generated); setDirty(false); }}>Сброс</Button>}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  return n < 1024 ? `${n} Б` : `${(n / 1024).toFixed(1)} КБ`;
}
