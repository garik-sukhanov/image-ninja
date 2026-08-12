import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../appStore';
import { useRasterStore, documentSize } from '../raster/rasterStore';
import { useSvgStore } from '../svg/svgStore';
import { composeToRgba } from '../raster/compose';
import { buildDocument } from '../projectIO';
import { serializeSvg } from '../svg/serialize';
import { RASTER_FORMATS, type ExportFormat, type ExportSettings } from '../types';
import { Button, NumberField, Slider, Toggle, normalizeHex } from './ui';
import { Icon } from './Icons';

const FORMAT_LABEL: Record<ExportFormat, string> = {
  png: 'PNG', jpeg: 'JPEG', webp: 'WEBP', avif: 'AVIF', tiff: 'TIFF', svg: 'SVG',
};

const LOSSY = new Set<ExportFormat>(['jpeg', 'webp', 'avif']);

export function ExportModal() {
  const open = useAppStore((s) => s.exportOpen);
  const setOpen = useAppStore((s) => s.setExportOpen);
  const current = useAppStore((s) => s.current);
  const showToast = useAppStore((s) => s.showToast);

  const isSvg = current?.kind === 'svg';
  const svgSettings = useSvgStore((s) => s.exportSettings);
  const rasterSettings = useRasterStore((s) => s.exportSettings);
  const settings = isSvg ? svgSettings : rasterSettings;

  const setSettings = useCallback(
    (patch: Partial<ExportSettings>) => {
      if (isSvg) useSvgStore.getState().setExportSettings(patch);
      else useRasterStore.getState().setExportSettings(patch);
    },
    [isSvg],
  );

  const svgCanvas = useSvgStore((s) => s.canvas);
  const [busy, setBusy] = useState(false);
  const [estimate, setEstimate] = useState<number | null>(null);

  const baseSize = useMemo(() => {
    if (isSvg) return { width: Math.round(svgCanvas.width), height: Math.round(svgCanvas.height) };
    return documentSize();
    // documentSize reads the raster store directly; the modal reopens on change.
  }, [isSvg, svgCanvas.width, svgCanvas.height, open]);

  const target = {
    width: settings.width ?? Math.max(1, Math.round(baseSize.width * settings.scale)),
    height: settings.height ?? Math.max(1, Math.round(baseSize.height * settings.scale)),
  };

  const formats: ExportFormat[] = isSvg ? ['svg', ...RASTER_FORMATS] : RASTER_FORMATS;

  useEffect(() => {
    if (!open) setEstimate(null);
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape' && open) setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  /** Renders the current document to RGBA at the requested output size. */
  const renderPixels = useCallback(async () => {
    if (!isSvg) {
      return composeToRgba({ scale: settings.scale, background: null });
    }
    const doc = buildDocument();
    if (!doc || doc.kind !== 'svg') return null;
    const source = serializeSvg(doc, { clean: true });
    return rasterizeSvg(source, target.width, target.height);
  }, [isSvg, settings.scale, target.width, target.height]);

  const runEstimate = useCallback(async () => {
    if (settings.format === 'svg') {
      const doc = buildDocument();
      if (!doc || doc.kind !== 'svg') return;
      const source = serializeSvg(doc, { clean: true });
      const out = settings.optimizeSvg ? await window.inj.svg.optimize(source, true) : source;
      setEstimate(new TextEncoder().encode(out).length);
      return;
    }
    setBusy(true);
    try {
      const pixels = await renderPixels();
      if (!pixels) return;
      const size = await window.inj.image.estimate({
        width: pixels.width,
        height: pixels.height,
        pixels: pixels.pixels,
        settings: { ...settings, width: target.width, height: target.height, scale: 1 },
      });
      setEstimate(size);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }, [settings, renderPixels, target.width, target.height]);

  const doExport = useCallback(async () => {
    const name = current?.name ?? 'export';
    const ext = settings.format === 'jpeg' ? 'jpg' : settings.format;
    const outPath = await window.inj.saveFileDialog(`${name}.${ext}`, ext);
    if (!outPath) return;

    setBusy(true);
    try {
      if (settings.format === 'svg') {
        const doc = buildDocument();
        if (!doc || doc.kind !== 'svg') return;
        // Honour the scale/size override by rewriting the root dimensions;
        // the viewBox keeps the artwork intact.
        const scaled = {
          ...doc,
          canvas: { ...doc.canvas, width: target.width, height: target.height },
        };
        const source = serializeSvg(scaled, { clean: true });
        const result = await window.inj.svg.write(outPath, source, settings.optimizeSvg);
        showToast(`Сохранено · ${formatBytes(result.size)}`);
      } else {
        const pixels = await renderPixels();
        if (!pixels) throw new Error('нечего экспортировать');
        const result = await window.inj.image.encode({
          width: pixels.width,
          height: pixels.height,
          pixels: pixels.pixels,
          settings: { ...settings, width: target.width, height: target.height, scale: 1 },
          outPath,
        });
        showToast(`Сохранено · ${formatBytes(result.size)}`);
      }
      setOpen(false);
      void window.inj.revealInFinder(outPath);
    } catch (e) {
      console.error(e);
      showToast(e instanceof Error ? e.message : 'Ошибка экспорта', 'error');
    } finally {
      setBusy(false);
    }
  }, [current?.name, settings, target.width, target.height, renderPixels, showToast, setOpen]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
    >
      <div className="bg-panel-2 border border-border rounded-xl w-[420px] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 h-11 border-b border-border">
          <h2 className="text-sm font-medium">Экспорт</h2>
          <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white">
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">Формат</p>
          <div className="grid grid-cols-3 gap-1 mb-4">
            {formats.map((f) => (
              <button
                key={f}
                onClick={() => { setSettings({ format: f }); setEstimate(null); }}
                className={`text-[11px] py-1.5 rounded transition-colors ${
                  settings.format === f ? 'bg-accent/20 text-accent' : 'bg-panel-3 text-gray-400 hover:text-white'
                }`}
              >
                {FORMAT_LABEL[f]}
              </button>
            ))}
          </div>

          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">Размер</p>
          <div className="grid grid-cols-2 gap-1.5 mb-2">
            <NumberField
              label="Ш"
              value={target.width}
              min={1}
              onChange={(v) => {
                setSettings({ width: Math.round(v), height: Math.round((v / baseSize.width) * baseSize.height) });
                setEstimate(null);
              }}
            />
            <NumberField
              label="В"
              value={target.height}
              min={1}
              onChange={(v) => {
                setSettings({ height: Math.round(v), width: Math.round((v / baseSize.height) * baseSize.width) });
                setEstimate(null);
              }}
            />
          </div>
          <div className="flex gap-1 mb-4">
            {[0.5, 1, 2, 3, 4].map((s) => (
              <button
                key={s}
                onClick={() => { setSettings({ scale: s, width: null, height: null }); setEstimate(null); }}
                className={`flex-1 text-[10px] py-1 rounded transition-colors ${
                  settings.width === null && settings.scale === s
                    ? 'bg-accent/20 text-accent'
                    : 'bg-panel-3 text-gray-400 hover:text-white'
                }`}
              >
                {s}×
              </button>
            ))}
          </div>

          {LOSSY.has(settings.format) && (
            <Slider
              label="Качество"
              value={settings.quality}
              min={1}
              max={100}
              step={1}
              onChange={(v) => { setSettings({ quality: Math.round(v) }); setEstimate(null); }}
              format={(v) => String(Math.round(v))}
              resetTo={90}
            />
          )}
          {settings.format === 'png' && (
            <Slider
              label="Сжатие палитры"
              value={settings.quality}
              min={1}
              max={100}
              step={1}
              onChange={(v) => { setSettings({ quality: Math.round(v) }); setEstimate(null); }}
              format={(v) => (v >= 100 ? 'без потерь' : String(Math.round(v)))}
              resetTo={100}
            />
          )}
          {settings.format === 'svg' && (
            <Toggle
              label="Оптимизировать через svgo"
              checked={settings.optimizeSvg}
              onChange={(v) => { setSettings({ optimizeSvg: v }); setEstimate(null); }}
            />
          )}

          {settings.format !== 'svg' && (
            <div className="mt-2">
              <Toggle
                label={settings.format === 'jpeg' ? 'Подложка (JPEG без альфы)' : 'Залить фон'}
                checked={settings.background !== null}
                onChange={(v) => { setSettings({ background: v ? '#ffffff' : null }); setEstimate(null); }}
              />
              {settings.background !== null && (
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="relative w-6 h-6 rounded border border-border overflow-hidden shrink-0">
                    <div className="absolute inset-0" style={{ background: settings.background }} />
                    <input
                      type="color"
                      value={normalizeHex(settings.background)}
                      onChange={(e) => { setSettings({ background: e.target.value }); setEstimate(null); }}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </div>
                  <input
                    type="text"
                    value={settings.background}
                    onChange={(e) => setSettings({ background: e.target.value })}
                    className="num-input flex-1"
                    spellCheck={false}
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
            <button
              onClick={() => void runEstimate()}
              disabled={busy}
              className="text-[10px] text-gray-500 hover:text-accent transition-colors disabled:opacity-40"
            >
              {busy ? 'Считаю…' : 'Оценить размер'}
            </button>
            {estimate !== null && (
              <span className="text-[10px] font-mono text-gray-300">≈ {formatBytes(estimate)}</span>
            )}
            <div className="flex-1" />
            <span className="text-[10px] font-mono text-gray-600">
              {target.width} × {target.height}
            </span>
          </div>
        </div>

        <div className="flex gap-2 px-4 py-3 border-t border-border bg-panel">
          <Button onClick={() => setOpen(false)} className="flex-1">Отмена</Button>
          <Button variant="accent" onClick={() => void doExport()} disabled={busy} className="flex-[2]">
            {busy ? 'Экспорт…' : 'Сохранить файл'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Rasterises an SVG string at an exact pixel size using the browser's own
 *  renderer, so the export matches what the canvas shows. */
async function rasterizeSvg(
  source: string,
  width: number,
  height: number,
): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  const sized = source.replace(
    /<svg([^>]*)>/,
    (match, attrs: string) => {
      const cleaned = attrs
        .replace(/\swidth="[^"]*"/, '')
        .replace(/\sheight="[^"]*"/, '');
      return `<svg${cleaned} width="${width}" height="${height}">`;
    },
  );

  const blob = new Blob([sized], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.width = width;
    img.height = height;
    img.src = url;
    await img.decode();

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height);
    return { pixels: new Uint8Array(data.data.buffer.slice(0)), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(2)} МБ`;
}
