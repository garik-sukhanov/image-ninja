import { useState } from 'react';
import { useSvgStore } from '../../svg/svgStore';
import { useAppStore } from '../../appStore';
import { rgbaFromUrl, traceInto } from '../../svg/trace';
import { DEFAULT_TRACE, type TraceOptions, type Underlay } from '../../types';
import { Icon } from '../Icons';
import { TraceControls } from './TraceControls';
import { Button, NumberField, Row, Section, Slider, Toggle, Hint } from '../ui';

export function UnderlayPanel() {
  const underlay = useSvgStore((s) => s.underlay);
  const underlayUrl = useSvgStore((s) => s.underlayUrl);
  const canvas = useSvgStore((s) => s.canvas);
  const setUnderlay = useSvgStore((s) => s.setUnderlay);
  const updateUnderlay = useSvgStore((s) => s.updateUnderlay);
  const showToast = useAppStore((s) => s.showToast);

  const [busy, setBusy] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceOptions>(DEFAULT_TRACE);

  const [vx, vy, vw, vh] = canvas.viewBox;

  const pick = async () => {
    const filePath = await window.inj.pickImageDialog('Выбрать подложку');
    if (!filePath) return;
    setBusy('Загрузка…');
    try {
      const probe = await window.inj.image.probe(filePath);
      const { url } = await window.inj.image.prepare(filePath);
      // Fit inside the artboard on first drop — a reference you can't see is
      // worse than one that's slightly off.
      const scale = Math.min(vw / probe.width, vh / probe.height, 1);
      const width = probe.width * scale;
      const height = probe.height * scale;
      const next: Underlay = {
        filePath,
        fileName: filePath.split('/').pop() ?? filePath,
        x: vx + (vw - width) / 2,
        y: vy + (vh - height) / 2,
        width,
        height,
        naturalWidth: probe.width,
        naturalHeight: probe.height,
        opacity: 0.6,
        visible: true,
        locked: true,
      };
      setUnderlay(next, url);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось открыть изображение', 'error');
    } finally {
      setBusy(null);
    }
  };

  const runTrace = async () => {
    if (!underlay || !underlayUrl) return;
    setBusy('Векторизация…');
    try {
      const source = await rgbaFromUrl(underlayUrl);
      const result = await traceInto(
        source,
        { x: underlay.x, y: underlay.y, width: underlay.width, height: underlay.height },
        trace,
        `Векторизация · ${underlay.fileName}`,
      );
      showToast(
        `${result.pathCount} контуров за ${result.ms} мс` +
          (result.droppedBackground ? ' · фон убран' : ''),
      );
    } catch (e) {
      console.error(e);
      showToast(e instanceof Error ? e.message : 'Ошибка векторизации', 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!underlay) {
    return (
      <Section title="Подложка">
        <Button onClick={() => void pick()} disabled={Boolean(busy)} className="w-full">
          <span className="flex items-center justify-center gap-1.5">
            <Icon name="image" size={13} /> {busy ?? 'Выбрать изображение'}
          </span>
        </Button>
        <Hint>Референс под холстом — обводить по нему и векторизовать. В экспорт не попадает.</Hint>
      </Section>
    );
  }

  const fit = () => {
    const scale = Math.min(vw / underlay.naturalWidth, vh / underlay.naturalHeight);
    const width = underlay.naturalWidth * scale;
    const height = underlay.naturalHeight * scale;
    updateUnderlay({ x: vx + (vw - width) / 2, y: vy + (vh - height) / 2, width, height });
  };

  const actual = () =>
    updateUnderlay({ width: underlay.naturalWidth, height: underlay.naturalHeight });

  const stretch = () => updateUnderlay({ x: vx, y: vy, width: vw, height: vh });

  return (
    <>
      <Section
        title="Подложка"
        right={
          <button
            onClick={() => setUnderlay(null, null)}
            className="text-[10px] px-1.5 py-0.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Убрать
          </button>
        }
      >
        <p className="text-[10px] text-gray-500 truncate mb-2" title={underlay.filePath}>
          {underlay.fileName}
          <span className="text-gray-700"> · {underlay.naturalWidth}×{underlay.naturalHeight}</span>
        </p>

        <Slider
          label="Непрозрачность"
          value={underlay.opacity}
          min={0.05}
          max={1}
          onChange={(v) => updateUnderlay({ opacity: v })}
          resetTo={0.6}
          format={(v) => `${Math.round(v * 100)}%`}
        />

        <Toggle
          label="Показывать"
          checked={underlay.visible}
          onChange={(v) => updateUnderlay({ visible: v })}
        />
        <Toggle
          label="Заблокирована"
          checked={underlay.locked}
          onChange={(v) => updateUnderlay({ locked: v })}
          hint="Разблокируйте, чтобы двигать подложку мышью по холсту"
        />

        <div className="grid grid-cols-2 gap-1.5 mt-2">
          <NumberField label="X" value={round(underlay.x)} onChange={(v) => updateUnderlay({ x: v })} />
          <NumberField label="Y" value={round(underlay.y)} onChange={(v) => updateUnderlay({ y: v })} />
          <NumberField
            label="Ш"
            value={round(underlay.width)}
            min={1}
            onChange={(v) =>
              updateUnderlay({ width: v, height: (v / underlay.naturalWidth) * underlay.naturalHeight })
            }
          />
          <NumberField
            label="В"
            value={round(underlay.height)}
            min={1}
            onChange={(v) =>
              updateUnderlay({ height: v, width: (v / underlay.naturalHeight) * underlay.naturalWidth })
            }
          />
        </div>

        <Row>
          <div className="flex gap-1 w-full mt-2">
            <Button onClick={fit} className="flex-1" title="Вписать в холст с сохранением пропорций">
              Вписать
            </Button>
            <Button onClick={actual} className="flex-1" title="Показать в исходном разрешении">
              1:1
            </Button>
            <Button onClick={stretch} className="flex-1" title="Растянуть на весь холст">
              По холсту
            </Button>
          </div>
        </Row>

        {!underlay.locked && <Hint>Подложку можно таскать мышью прямо по холсту.</Hint>}
      </Section>

      <Section title="Векторизация" defaultOpen={false}>
        <TraceControls value={trace} onChange={setTrace} />

        <div className="mt-2">
          <Button variant="accent" onClick={() => void runTrace()} disabled={Boolean(busy)} className="w-full">
            {busy ?? 'Векторизовать подложку'}
          </Button>
        </div>
        <Hint>
          Результат ложится группой поверх подложки, точно по её рамке. Исходник свыше 2048 px
          сначала уменьшается — на качестве вектора это не сказывается.
        </Hint>
      </Section>
    </>
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
