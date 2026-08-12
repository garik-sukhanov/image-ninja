import type { TraceOptions } from '../../types';
import { Segmented, Slider, Toggle } from '../ui';

/** Tracing parameters, shared by the SVG underlay panel and the raster editor. */
export function TraceControls({
  value,
  onChange,
}: {
  value: TraceOptions;
  onChange: (next: TraceOptions) => void;
}) {
  const set = <K extends keyof TraceOptions>(key: K) => (v: TraceOptions[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <>
      <Segmented
        value={value.mode}
        onChange={set('mode')}
        options={[
          { value: 'color', label: 'Цвет', title: 'Кластеризация по цветам' },
          { value: 'bw', label: 'Ч/Б', title: 'Один силуэт, чёрно-белая трассировка' },
        ]}
      />

      <div className="mt-2">
        <Segmented
          value={value.curve}
          onChange={set('curve')}
          options={[
            { value: 'spline', label: 'Сплайны', title: 'Гладкие кривые Безье' },
            { value: 'polygon', label: 'Полигоны', title: 'Прямые сегменты' },
            { value: 'none', label: 'Пиксели', title: 'Без упрощения' },
          ]}
        />
      </div>

      <div className="mt-3">
        <Slider
          label="Убирать крапинки"
          value={value.filterSpeckle}
          min={0}
          max={32}
          step={1}
          onChange={set('filterSpeckle')}
          format={(v) => `${Math.round(v)} px`}
          resetTo={4}
        />

        {value.mode === 'color' && (
          <>
            <Slider
              label="Точность цвета"
              value={value.colorPrecision}
              min={1}
              max={8}
              step={1}
              onChange={set('colorPrecision')}
              format={(v) => `${Math.round(v)} бит`}
              resetTo={6}
            />
            <Slider
              label="Слияние слоёв"
              value={value.layerDifference}
              min={0}
              max={64}
              step={1}
              onChange={set('layerDifference')}
              format={(v) => String(Math.round(v))}
              resetTo={16}
            />
            <div className="mt-1 mb-2">
              <Segmented
                value={value.hierarchical}
                onChange={set('hierarchical')}
                options={[
                  { value: 'stacked', label: 'Стопкой', title: 'Слои лежат друг на друге' },
                  { value: 'cutout', label: 'Вырезом', title: 'Каждый слой вырезан из нижнего' },
                ]}
              />
            </div>
          </>
        )}

        {value.curve === 'spline' && (
          <>
            <Slider
              label="Порог угла"
              value={value.cornerThreshold}
              min={0}
              max={180}
              step={1}
              onChange={set('cornerThreshold')}
              format={(v) => `${Math.round(v)}°`}
              resetTo={60}
            />
            <Slider
              label="Длина сегмента"
              value={value.lengthThreshold}
              min={1}
              max={20}
              step={0.5}
              onChange={set('lengthThreshold')}
              format={(v) => String(v)}
              resetTo={4}
            />
          </>
        )}

        <Toggle
          label="Убрать фоновый контур"
          checked={value.dropBackground}
          onChange={set('dropBackground')}
          hint="Трассировка обводит и фон тоже — этот контур на всю картинку выбрасывается"
        />
      </div>
    </>
  );
}
