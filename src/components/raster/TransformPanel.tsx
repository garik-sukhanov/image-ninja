import { useRasterStore, documentSize } from '../../raster/rasterStore';
import { Icon } from '../Icons';
import { Button, NumberField, Row, Section } from '../ui';

const ASPECTS: { label: string; value: number | null }[] = [
  { label: 'Свободно', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '3:2', value: 3 / 2 },
  { label: '2:3', value: 2 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
];

export function TransformPanel() {
  const rotate = useRasterStore((s) => s.rotate);
  const flipH = useRasterStore((s) => s.flipH);
  const flipV = useRasterStore((s) => s.flipV);
  const crop = useRasterStore((s) => s.crop);
  const cropDraft = useRasterStore((s) => s.cropDraft);
  const cropAspect = useRasterStore((s) => s.cropAspect);
  const oriented = useRasterStore((s) => s.oriented);
  const source = useRasterStore((s) => s.source);
  const tool = useRasterStore((s) => s.tool);

  const rotateBy = useRasterStore((s) => s.rotateBy);
  const setFlip = useRasterStore((s) => s.setFlip);
  const setCrop = useRasterStore((s) => s.setCrop);
  const setCropDraft = useRasterStore((s) => s.setCropDraft);
  const setCropAspect = useRasterStore((s) => s.setCropAspect);
  const setTool = useRasterStore((s) => s.setTool);

  const size = documentSize();
  const rect = cropDraft ?? crop;

  const applyAspect = (aspect: number | null) => {
    setCropAspect(aspect);
    if (!oriented) return;
    setTool('crop');
    if (aspect === null) return;
    // Largest centred box with that ratio.
    const full = { w: oriented.width, h: oriented.height };
    let w = full.w;
    let h = w / aspect;
    if (h > full.h) { h = full.h; w = h * aspect; }
    setCropDraft({ x: (full.w - w) / 2, y: (full.h - h) / 2, width: w, height: h });
  };

  return (
    <Section title="Кадр">
      <Row>
        <button onClick={() => rotateBy(-90)} className="tool-btn" title="Повернуть влево">
          <Icon name="rotateLeft" />
        </button>
        <button onClick={() => rotateBy(90)} className="tool-btn" title="Повернуть вправо">
          <Icon name="rotateRight" />
        </button>
        <button
          onClick={() => setFlip(!flipH, flipV)}
          className={`tool-btn ${flipH ? 'tool-btn-active' : ''}`}
          title="Отразить по горизонтали"
        >
          <Icon name="flipH" />
        </button>
        <button
          onClick={() => setFlip(flipH, !flipV)}
          className={`tool-btn ${flipV ? 'tool-btn-active' : ''}`}
          title="Отразить по вертикали"
        >
          <Icon name="flipV" />
        </button>
        <div className="flex-1" />
        <span className="text-[10px] text-gray-600 font-mono">{rotate}°</span>
      </Row>

      <div className="grid grid-cols-4 gap-1 mt-2.5">
        {ASPECTS.map((a) => (
          <button
            key={a.label}
            onClick={() => applyAspect(a.value)}
            className={`text-[10px] py-1 rounded transition-colors ${
              cropAspect === a.value && tool === 'crop'
                ? 'bg-accent/20 text-accent'
                : 'bg-panel-3 text-gray-400 hover:text-white'
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      {rect && (
        <div className="grid grid-cols-2 gap-1.5 mt-2.5">
          <NumberField label="X" value={Math.round(rect.x)} onChange={(v) => setCropDraft({ ...rect, x: v })} />
          <NumberField label="Y" value={Math.round(rect.y)} onChange={(v) => setCropDraft({ ...rect, y: v })} />
          <NumberField label="Ш" value={Math.round(rect.width)} onChange={(v) => setCropDraft({ ...rect, width: Math.max(1, v) })} />
          <NumberField label="В" value={Math.round(rect.height)} onChange={(v) => setCropDraft({ ...rect, height: Math.max(1, v) })} />
        </div>
      )}

      <Row gap={1.5}>
        <div className="mt-2 flex gap-1.5 w-full">
          {crop && (
            <Button onClick={() => { setCrop(null); setCropDraft(null); }} className="flex-1">
              Сбросить обрезку
            </Button>
          )}
          {cropDraft && (
            <Button variant="accent" onClick={() => useRasterStore.getState().applyCropDraft()} className="flex-1">
              Применить
            </Button>
          )}
        </div>
      </Row>

      <p className="text-[10px] text-gray-600 mt-2 font-mono">
        {size.width} × {size.height}
        {source && (size.width !== source.width || size.height !== source.height) && (
          <span className="text-gray-700"> · оригинал {source.width} × {source.height}</span>
        )}
      </p>
    </Section>
  );
}
