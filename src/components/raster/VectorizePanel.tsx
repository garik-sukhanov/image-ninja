import { useState } from 'react';
import { useAppStore } from '../../appStore';
import { composeDocument } from '../../raster/compose';
import { rgbaFromCanvas, traceToParsed } from '../../svg/trace';
import { openProject, saveCurrentProject } from '../../projectIO';
import { DEFAULT_EXPORT, DEFAULT_TRACE, SCHEMA_VERSION, type SvgDocument, type TraceOptions } from '../../types';
import { TraceControls } from '../svg/TraceControls';
import { Icon } from '../Icons';
import { Button, Hint, Section } from '../ui';

/**
 * Raster → vector. Traces exactly what the canvas shows (crop, mask and colour
 * pipeline all applied) and opens the result as a new SVG project, leaving the
 * original raster project untouched.
 */
export function VectorizePanel() {
  const current = useAppStore((s) => s.current);
  const showToast = useAppStore((s) => s.showToast);
  const [options, setOptions] = useState<TraceOptions>(DEFAULT_TRACE);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const composed = composeDocument();
      if (!composed) throw new Error('нечего векторизовать');

      const source = rgbaFromCanvas(composed.canvas);
      const { parsed, pathCount, ms } = await traceToParsed(source, options);

      // Keep the artboard at the raster document's real size, not the
      // downscaled resolution the tracer worked at.
      const [vbx, vby] = parsed.canvas.viewBox;
      const canvasBox = {
        width: composed.width,
        height: composed.height,
        viewBox: [vbx, vby, parsed.canvas.viewBox[2], parsed.canvas.viewBox[3]] as [number, number, number, number],
      };

      const now = new Date().toISOString();
      const doc: SvgDocument = {
        schemaVersion: SCHEMA_VERSION,
        kind: 'svg',
        id: '',
        name: `${current?.name ?? 'Векторизация'} (вектор)`,
        createdAt: now,
        updatedAt: now,
        canvas: canvasBox,
        rootAttrs: {},
        defs: parsed.defs,
        order: parsed.order,
        nodes: parsed.nodes,
        exportSettings: { ...DEFAULT_EXPORT, format: 'svg' },
        ui: { zoom: 1, panX: 0, panY: 0 },
      };

      // Flush the raster project before switching, so nothing in flight is lost.
      await saveCurrentProject();
      const created = await window.inj.projects.create(doc);
      showToast(`${pathCount} контуров за ${ms} мс`);
      await openProject(created.id);
    } catch (e) {
      console.error(e);
      showToast(e instanceof Error ? e.message : 'Ошибка векторизации', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Векторизация" defaultOpen={false}>
      <TraceControls value={options} onChange={setOptions} />
      <div className="mt-2">
        <Button variant="accent" onClick={() => void run()} disabled={busy} className="w-full">
          <span className="flex items-center justify-center gap-1.5">
            <Icon name="pen" size={13} />
            {busy ? 'Векторизация…' : 'Преобразовать в SVG'}
          </span>
        </Button>
      </div>
      <Hint>
        Векторизуется то, что на холсте: с обрезкой, вырезанным фоном и цветокоррекцией.
        Результат откроется как новый SVG-проект, растровый останется на месте.
      </Hint>
    </Section>
  );
}
