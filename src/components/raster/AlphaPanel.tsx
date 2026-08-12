import { useCallback, useEffect, useState } from 'react';
import { useRasterStore } from '../../raster/rasterStore';
import { useAppStore } from '../../appStore';
import { syncMaskCanvas } from '../../raster/maskCanvas';
import { featherSelection } from '../../raster/selection';
import type { ModelStatus } from '../../types';
import { Icon } from '../Icons';
import { Button, Hint, Row, Section, Slider, Toggle } from '../ui';

type ModelEntry = ModelStatus & { id: string };

export function AlphaPanel() {
  const tool = useRasterStore((s) => s.tool);
  const mask = useRasterStore((s) => s.mask);
  const adjustments = useRasterStore((s) => s.adjustments);
  const setAdjustment = useRasterStore((s) => s.setAdjustment);
  const showMaskOverlay = useRasterStore((s) => s.showMaskOverlay);
  const setShowMaskOverlay = useRasterStore((s) => s.setShowMaskOverlay);
  const clearMask = useRasterStore((s) => s.clearMask);
  const invertMask = useRasterStore((s) => s.invertMask);

  return (
    <>
      <Section title="Удаление фона">
        <AiRemoval />

        <div className="h-px bg-border my-3" />

        <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
          Волшебная палочка
        </p>
        <WandSettings />

        <div className="h-px bg-border my-3" />

        <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">Кисть</p>
        <BrushSettings />

        {(tool === 'eraser' || tool === 'restore') && (
          <Hint>Alt при клике палочкой — вернуть область вместо удаления.</Hint>
        )}
      </Section>

      <Section title="Альфа-канал">
        <Slider
          label="Непрозрачность"
          value={adjustments.opacity}
          min={0}
          max={1}
          onChange={(v) => setAdjustment('opacity', v)}
          resetTo={1}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Порог отсечки"
          value={adjustments.alphaFloor}
          min={0}
          max={1}
          onChange={(v) => setAdjustment('alphaFloor', v)}
          format={(v) => String(Math.round(v * 255))}
        />
        <Hint>Порог обнуляет почти прозрачные пиксели — убирает ореол по краям выреза.</Hint>

        <div className="h-px bg-border my-2.5" />

        <Toggle
          label="Подсветить удалённое"
          checked={showMaskOverlay}
          onChange={setShowMaskOverlay}
          hint="Красная заливка там, где стало прозрачно"
        />

        <Row>
          <div className="flex gap-1.5 w-full mt-2">
            <Button onClick={invertMask} disabled={!mask} className="flex-1">
              Инвертировать
            </Button>
            <Button onClick={clearMask} disabled={!mask} variant="danger" className="flex-1">
              Сбросить маску
            </Button>
          </div>
        </Row>
      </Section>
    </>
  );
}

function WandSettings() {
  const tolerance = useRasterStore((s) => s.wandTolerance);
  const contiguous = useRasterStore((s) => s.wandContiguous);
  const feather = useRasterStore((s) => s.wandFeather);
  const expand = useRasterStore((s) => s.wandExpand);
  const setWand = useRasterStore((s) => s.setWand);

  return (
    <>
      <Slider
        label="Допуск"
        value={tolerance}
        min={1}
        max={128}
        step={1}
        onChange={(v) => setWand({ wandTolerance: v })}
        format={(v) => String(Math.round(v))}
        resetTo={32}
      />
      <Slider
        label="Растушёвка"
        value={feather}
        min={0}
        max={12}
        step={1}
        onChange={(v) => setWand({ wandFeather: v })}
        format={(v) => `${Math.round(v)} px`}
      />
      <Slider
        label="Расширить / сжать"
        value={expand}
        min={-8}
        max={8}
        step={1}
        onChange={(v) => setWand({ wandExpand: v })}
        format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)} px`}
      />
      <Toggle
        label="Только смежная область"
        checked={contiguous}
        onChange={(v) => setWand({ wandContiguous: v })}
        hint="Выключено — удаляются все похожие пиксели по всему изображению"
      />
    </>
  );
}

function BrushSettings() {
  const brushSize = useRasterStore((s) => s.brushSize);
  const brushHardness = useRasterStore((s) => s.brushHardness);
  const brushStrength = useRasterStore((s) => s.brushStrength);
  const setBrush = useRasterStore((s) => s.setBrush);

  return (
    <>
      <Slider
        label="Размер"
        value={brushSize}
        min={2}
        max={600}
        step={1}
        onChange={(v) => setBrush({ brushSize: v })}
        format={(v) => `${Math.round(v)} px`}
        resetTo={48}
      />
      <Slider
        label="Жёсткость"
        value={brushHardness}
        min={0}
        max={1}
        onChange={(v) => setBrush({ brushHardness: v })}
        format={(v) => `${Math.round(v * 100)}%`}
        resetTo={0.7}
      />
      <Slider
        label="Нажим"
        value={brushStrength}
        min={0.05}
        max={1}
        onChange={(v) => setBrush({ brushStrength: v })}
        format={(v) => `${Math.round(v * 100)}%`}
        resetTo={1}
      />
      <Hint>Клавиши [ и ] меняют размер кисти.</Hint>
    </>
  );
}

function AiRemoval() {
  const modelId = useRasterStore((s) => s.modelId);
  const setModelId = useRasterStore((s) => s.setModelId);
  const busy = useRasterStore((s) => s.busy);
  const setBusy = useRasterStore((s) => s.setBusy);
  const showToast = useAppStore((s) => s.showToast);

  const [models, setModels] = useState<ModelEntry[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [threshold, setThreshold] = useState(0.5);
  const [edgeFeather, setEdgeFeather] = useState(1);

  const refresh = useCallback(() => {
    window.inj.segment.models().then(setModels).catch(() => setModels([]));
  }, []);

  useEffect(refresh, [refresh]);

  useEffect(() => window.inj.segment.onDownloadProgress((p) => {
    setProgress(p.total ? p.received / p.total : null);
  }), []);

  const active = models.find((m) => m.id === modelId);

  const download = async () => {
    setBusy('Загрузка модели…');
    setProgress(0);
    try {
      await window.inj.segment.download(modelId);
      refresh();
      showToast('Модель загружена');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Не удалось загрузить модель', 'error');
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const run = async () => {
    const s = useRasterStore.getState();
    if (!s.oriented || !s.orientedPixels) return;
    setBusy('Анализ изображения…');
    try {
      const { width, height, data } = s.orientedPixels;
      const result = await window.inj.segment.run(
        modelId, width, height, new Uint8Array(data.buffer.slice(0)),
      );

      // Turn the probability map into an alpha mask: values above the
      // threshold ramp up to opaque, values below fall away to nothing.
      let alpha: Uint8Array = new Uint8Array(result.mask.length);
      const t = threshold * 255;
      const ramp = 40;
      for (let i = 0; i < alpha.length; i++) {
        const v = result.mask[i];
        alpha[i] = v <= t - ramp ? 0 : v >= t + ramp ? 255
          : Math.round(((v - (t - ramp)) / (ramp * 2)) * 255);
      }
      if (edgeFeather > 0) alpha = featherSelection(alpha, width, height, edgeFeather);

      s.pushHistory();
      s.setMask(alpha);
      syncMaskCanvas(alpha, width, height);
      showToast('Фон удалён');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      showToast(
        message.includes('model-missing') ? 'Сначала скачайте модель' : 'Ошибка сегментации',
        'error',
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <select
        value={modelId}
        onChange={(e) => setModelId(e.target.value)}
        className="w-full bg-panel-3 border border-border rounded px-2 py-1.5 text-[11px] outline-none focus:border-accent mb-2"
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} · {m.sizeMb} МБ {m.installed ? '✓' : ''}
          </option>
        ))}
      </select>

      {active && !active.installed ? (
        <>
          <Button onClick={download} disabled={Boolean(busy)} variant="accent" className="w-full">
            {progress !== null
              ? `Загрузка… ${Math.round(progress * 100)}%`
              : `Скачать модель (${active.sizeMb} МБ)`}
          </Button>
          <Hint>
            Модель скачивается один раз и работает офлайн — изображения никуда не отправляются.
          </Hint>
        </>
      ) : (
        <>
          <Button onClick={run} disabled={Boolean(busy)} variant="accent" className="w-full">
            <span className="flex items-center justify-center gap-1.5">
              <Icon name="sparkles" size={13} />
              {busy ?? 'Удалить фон автоматически'}
            </span>
          </Button>
          <div className="mt-2">
            <Slider
              label="Порог"
              value={threshold}
              min={0.05}
              max={0.95}
              onChange={setThreshold}
              format={(v) => String(Math.round(v * 100))}
              resetTo={0.5}
            />
            <Slider
              label="Смягчить край"
              value={edgeFeather}
              min={0}
              max={8}
              step={1}
              onChange={setEdgeFeather}
              format={(v) => `${Math.round(v)} px`}
              resetTo={1}
            />
          </div>
        </>
      )}
    </>
  );
}
