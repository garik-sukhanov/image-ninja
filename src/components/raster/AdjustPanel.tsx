import { useRasterStore } from '../../raster/rasterStore';
import { NEUTRAL_ADJUSTMENTS, type Adjustments } from '../../types';
import { Button, Hint, Section, Slider, Toggle } from '../ui';

/** Percentile-clipped auto tone: find the 0.5 % black and white points and
 *  stretch the range between them. */
function autoTone(pixels: ImageData): Partial<Adjustments> {
  const hist = new Uint32Array(256);
  const d = pixels.data;
  let counted = 0;
  // Sample every 4th pixel — plenty for a histogram, 4× faster.
  for (let i = 0; i < d.length; i += 16) {
    if (d[i + 3] < 8) continue;
    const luma = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) | 0;
    hist[luma] += 1;
    counted += 1;
  }
  if (counted === 0) return {};

  const clip = counted * 0.005;
  let acc = 0;
  let lo = 0;
  let hi = 255;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= clip) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= clip) { hi = i; break; } }
  if (hi - lo < 8) return {};

  // Map [lo, hi] → [0, 255]: gain sets contrast, the midpoint sets brightness.
  const gain = 255 / (hi - lo);
  const contrast = Math.max(-0.9, Math.min(1.5, gain - 1));
  const mid = (lo + hi) / 2 / 255;
  const brightness = Math.max(-1, Math.min(1, (0.5 - mid) * 1.2));
  return { contrast, brightness };
}

export function AdjustPanel() {
  const adjustments = useRasterStore((s) => s.adjustments);
  const setAdjustment = useRasterStore((s) => s.setAdjustment);
  const resetAdjustments = useRasterStore((s) => s.resetAdjustments);
  const orientedPixels = useRasterStore((s) => s.orientedPixels);

  const set = <K extends keyof Adjustments>(key: K) => (v: Adjustments[K]) => setAdjustment(key, v);

  const dirty = Object.entries(adjustments).some(
    ([k, v]) => v !== NEUTRAL_ADJUSTMENTS[k as keyof Adjustments],
  );

  return (
    <Section
      title="Цветокоррекция"
      right={
        <div className="flex gap-1">
          <button
            onClick={() => {
              if (!orientedPixels) return;
              const patch = autoTone(orientedPixels);
              for (const [k, v] of Object.entries(patch)) {
                setAdjustment(k as keyof Adjustments, v as never);
              }
            }}
            className="text-[10px] px-1.5 py-0.5 rounded text-gray-500 hover:text-accent hover:bg-panel-3 transition-colors"
            title="Автоуровни по гистограмме"
          >
            Авто
          </button>
          {dirty && (
            <button
              onClick={resetAdjustments}
              className="text-[10px] px-1.5 py-0.5 rounded text-gray-500 hover:text-white hover:bg-panel-3 transition-colors"
            >
              Сброс
            </button>
          )}
        </div>
      }
    >
      <Slider label="Экспозиция" value={adjustments.exposure} onChange={set('exposure')} />
      <Slider label="Яркость" value={adjustments.brightness} onChange={set('brightness')} />
      <Slider label="Контраст" value={adjustments.contrast} onChange={set('contrast')} />
      <Slider label="Гамма" value={adjustments.gamma} onChange={set('gamma')} />

      <div className="h-px bg-border my-2.5" />

      <Slider label="Насыщенность" value={adjustments.saturation} onChange={set('saturation')} />
      <Slider label="Сочность" value={adjustments.vibrance} onChange={set('vibrance')} />
      <Slider
        label="Оттенок"
        value={adjustments.hue}
        min={-180}
        max={180}
        step={1}
        onChange={set('hue')}
        format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}°`}
      />
      <Slider label="Температура" value={adjustments.temperature} onChange={set('temperature')} />
      <Slider label="Тон (зел./пурп.)" value={adjustments.tint} onChange={set('tint')} />

      <div className="h-px bg-border my-2.5" />

      <Slider
        label="Резкость"
        value={adjustments.sharpen}
        min={0}
        max={1}
        onChange={set('sharpen')}
        format={(v) => String(Math.round(v * 100))}
      />
      <Slider
        label="Размытие"
        value={adjustments.blur}
        min={0}
        max={1}
        onChange={set('blur')}
        format={(v) => String(Math.round(v * 100))}
      />

      <div className="h-px bg-border my-2.5" />

      <Toggle label="Ч/Б" checked={adjustments.grayscale} onChange={set('grayscale')} />
      <Toggle label="Инверсия" checked={adjustments.invert} onChange={set('invert')} />

      {(adjustments.sharpen > 0 || adjustments.blur > 0) && (
        <Hint>Резкость и размытие скрываются во время рисования кистью, чтобы не тормозить, и возвращаются после отпускания.</Hint>
      )}
      <div className="mt-2">
        <Button onClick={resetAdjustments} disabled={!dirty} className="w-full">
          Вернуть исходный вид
        </Button>
      </div>
    </Section>
  );
}
