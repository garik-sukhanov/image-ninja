import { useMemo } from 'react';
import { useSvgStore } from '../../svg/svgStore';
import { getContentGroup } from '../../svg/dom';
import {
  boundsOf, decompose, findElement, frameOf, parseTransform, unionRects,
  type Rect,
} from '../../svg/geometry';
import { applyCanvasMatrix, rotateAboutMatrix, scaleAboutMatrix, translationMatrix } from '../../svg/transform';
import { booleanPaths, pathToPolygons, type BooleanOp } from '../../svg/boolean';
import { nodeToPathData } from '../../svg/path';
import { useAppStore } from '../../appStore';
import { Icon, type IconName } from '../Icons';
import { Button, ColorField, NumberField, Row, Section, Slider } from '../ui';

export function InspectorPanel() {
  const selection = useSvgStore((s) => s.selection);
  const nodes = useSvgStore((s) => s.nodes);

  if (selection.length === 0) return <ArtboardSection />;

  return (
    <>
      <GeometrySection />
      <PaintSection />
      {selection.length === 1 && nodes[selection[0]]?.tag === 'text' && <TextSection />}
      {selection.length > 1 && <ArrangeSection />}
      {selection.length > 1 && <BooleanSection />}
      {selection.length === 1 && <AttributesSection />}
    </>
  );
}

// ---------------------------------------------------------------------------

function ArtboardSection() {
  const canvas = useSvgStore((s) => s.canvas);
  const setCanvas = useSvgStore((s) => s.setCanvas);
  const transparentBg = useSvgStore((s) => s.transparentBg);
  const showGrid = useSvgStore((s) => s.showGrid);
  const snapToGrid = useSvgStore((s) => s.snapToGrid);
  const gridSize = useSvgStore((s) => s.gridSize);
  const toggleFlag = useSvgStore((s) => s.toggleFlag);
  const setGridSize = useSvgStore((s) => s.setGridSize);

  const [vx, vy, vw, vh] = canvas.viewBox;

  return (
    <>
      <Section title="Холст">
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField label="Ш" value={canvas.width} onChange={(v) => setCanvas({ width: Math.max(1, v) })} />
          <NumberField label="В" value={canvas.height} onChange={(v) => setCanvas({ height: Math.max(1, v) })} />
        </div>
        <p className="text-[10px] uppercase tracking-wider text-gray-500 mt-3 mb-1.5">viewBox</p>
        <div className="grid grid-cols-2 gap-1.5">
          <NumberField label="X" value={vx} onChange={(v) => setCanvas({ viewBox: [v, vy, vw, vh] })} />
          <NumberField label="Y" value={vy} onChange={(v) => setCanvas({ viewBox: [vx, v, vw, vh] })} />
          <NumberField label="Ш" value={vw} onChange={(v) => setCanvas({ viewBox: [vx, vy, Math.max(1, v), vh] })} />
          <NumberField label="В" value={vh} onChange={(v) => setCanvas({ viewBox: [vx, vy, vw, Math.max(1, v)] })} />
        </div>
        <div className="mt-2">
          <Button
            onClick={() => setCanvas({ viewBox: [0, 0, canvas.width, canvas.height] })}
            className="w-full"
            title="Сделать viewBox равным размеру холста"
          >
            Синхронизировать с размером
          </Button>
        </div>
      </Section>

      <Section title="Вид">
        <label className="flex items-center gap-2 text-[11px] cursor-pointer py-0.5">
          <input type="checkbox" checked={transparentBg} onChange={() => toggleFlag('transparentBg')} className="accent-accent w-3 h-3" />
          <span className="text-gray-300">Прозрачный фон</span>
        </label>
        <label className="flex items-center gap-2 text-[11px] cursor-pointer py-0.5">
          <input type="checkbox" checked={showGrid} onChange={() => toggleFlag('showGrid')} className="accent-accent w-3 h-3" />
          <span className="text-gray-300">Показывать сетку</span>
        </label>
        <label className="flex items-center gap-2 text-[11px] cursor-pointer py-0.5">
          <input type="checkbox" checked={snapToGrid} onChange={() => toggleFlag('snapToGrid')} className="accent-accent w-3 h-3" />
          <span className="text-gray-300">Привязка к сетке</span>
        </label>
        <div className="mt-1.5">
          <NumberField label="Шаг" value={gridSize} onChange={setGridSize} min={1} />
        </div>
      </Section>

      <Section title="Стиль новых фигур">
        <ShapeDefaults />
      </Section>
    </>
  );
}

function ShapeDefaults() {
  const defaults = useSvgStore((s) => s.defaults);
  const setDefaults = useSvgStore((s) => s.setDefaults);
  return (
    <>
      <ColorField label="Заливка" value={defaults.fill} onChange={(v) => setDefaults({ fill: v })} />
      <ColorField label="Обводка" value={defaults.stroke} onChange={(v) => setDefaults({ stroke: v })} />
      <div className="grid grid-cols-2 gap-1.5 mt-1">
        <NumberField label="Т" value={defaults.strokeWidth} onChange={(v) => setDefaults({ strokeWidth: Math.max(0, v) })} step={0.5} />
        <NumberField label="N" value={defaults.polygonSides} onChange={(v) => setDefaults({ polygonSides: Math.max(3, Math.round(v)) })} />
      </div>
      <div className="grid grid-cols-2 gap-1.5 mt-1.5">
        <NumberField label="★" value={defaults.starPoints} onChange={(v) => setDefaults({ starPoints: Math.max(3, Math.round(v)) })} />
        <NumberField label="↧" value={defaults.starInner} onChange={(v) => setDefaults({ starInner: v })} step={0.05} min={0.05} max={0.95} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

/** Live bounds of the current selection, measured from the rendered DOM. */
function useSelectionBounds(): { rect: Rect | null; single: boolean } {
  const selection = useSvgStore((s) => s.selection);
  const nodes = useSvgStore((s) => s.nodes);

  return useMemo(() => {
    const content = getContentGroup();
    if (!content || selection.length === 0) return { rect: null, single: false };
    const rects: Rect[] = [];
    for (const id of selection) {
      const el = findElement(content, id);
      if (!el) continue;
      const bounds = boundsOf(content, el);
      if (bounds) rects.push(bounds);
    }
    return { rect: unionRects(rects), single: selection.length === 1 };
    // `nodes` is a dependency because any attribute edit can move the bounds.
  }, [selection, nodes]);
}

function GeometrySection() {
  const selection = useSvgStore((s) => s.selection);
  const nodes = useSvgStore((s) => s.nodes);
  const { rect } = useSelectionBounds();

  const rotation = useMemo(() => {
    if (selection.length !== 1) return 0;
    const node = nodes[selection[0]];
    if (!node) return 0;
    return Math.round(decompose(parseTransform(node.attrs.transform)).rotate * 10) / 10;
  }, [selection, nodes]);

  const apply = (matrix: DOMMatrix) => {
    const content = getContentGroup();
    if (!content) return;
    const store = useSvgStore.getState();
    store.pushHistory();
    for (const id of store.selection) {
      const node = store.nodes[id];
      if (!node || node.locked) continue;
      const transform = applyCanvasMatrix(content, node, matrix);
      store.updateAttrs(id, { transform: transform || null });
    }
  };

  if (!rect) return null;

  return (
    <Section title="Позиция и размер">
      <div className="grid grid-cols-2 gap-1.5">
        <NumberField label="X" value={round(rect.x)} onChange={(v) => apply(translationMatrix(v - rect.x, 0))} />
        <NumberField label="Y" value={round(rect.y)} onChange={(v) => apply(translationMatrix(0, v - rect.y))} />
        <NumberField
          label="Ш"
          value={round(rect.width)}
          min={0.1}
          onChange={(v) => apply(scaleAboutMatrix(v / (rect.width || 1), 1, rect.x, rect.y))}
        />
        <NumberField
          label="В"
          value={round(rect.height)}
          min={0.1}
          onChange={(v) => apply(scaleAboutMatrix(1, v / (rect.height || 1), rect.x, rect.y))}
        />
      </div>

      <div className="grid grid-cols-2 gap-1.5 mt-1.5">
        <NumberField
          label="∠"
          value={rotation}
          step={1}
          onChange={(v) => apply(rotateAboutMatrix(v - rotation, rect.x + rect.width / 2, rect.y + rect.height / 2))}
        />
        <div className="flex gap-1">
          <button
            onClick={() => apply(scaleAboutMatrix(-1, 1, rect.x + rect.width / 2, rect.y + rect.height / 2))}
            className="tool-btn !w-full !h-7"
            title="Отразить по горизонтали"
          >
            <Icon name="flipH" size={13} />
          </button>
          <button
            onClick={() => apply(scaleAboutMatrix(1, -1, rect.x + rect.width / 2, rect.y + rect.height / 2))}
            className="tool-btn !w-full !h-7"
            title="Отразить по вертикали"
          >
            <Icon name="flipV" size={13} />
          </button>
        </div>
      </div>

      <AlignRow />
    </Section>
  );
}

const ALIGN_BUTTONS: { id: string; icon: IconName; title: string }[] = [
  { id: 'left', icon: 'alignLeft', title: 'По левому краю' },
  { id: 'centerX', icon: 'alignCenterX', title: 'По центру (гориз.)' },
  { id: 'right', icon: 'alignRight', title: 'По правому краю' },
  { id: 'top', icon: 'alignTop', title: 'По верхнему краю' },
  { id: 'centerY', icon: 'alignCenterY', title: 'По центру (верт.)' },
  { id: 'bottom', icon: 'alignBottom', title: 'По нижнему краю' },
];

function AlignRow() {
  const selection = useSvgStore((s) => s.selection);
  const canvas = useSvgStore((s) => s.canvas);

  const align = (mode: string) => {
    const content = getContentGroup();
    if (!content) return;
    const store = useSvgStore.getState();

    const entries = store.selection
      .map((id) => {
        const el = findElement(content, id);
        const bounds = el ? boundsOf(content, el) : null;
        return bounds ? { id, bounds } : null;
      })
      .filter((x): x is { id: string; bounds: Rect } => Boolean(x));
    if (entries.length === 0) return;

    // One object aligns to the artboard; several align to their shared bounds.
    const [vx, vy, vw, vh] = canvas.viewBox;
    const frame =
      entries.length === 1
        ? { x: vx, y: vy, width: vw, height: vh }
        : unionRects(entries.map((e) => e.bounds))!;

    store.pushHistory();
    for (const { id, bounds } of entries) {
      const node = store.nodes[id];
      if (!node || node.locked) continue;
      let dx = 0;
      let dy = 0;
      if (mode === 'left') dx = frame.x - bounds.x;
      if (mode === 'right') dx = frame.x + frame.width - (bounds.x + bounds.width);
      if (mode === 'centerX') dx = frame.x + frame.width / 2 - (bounds.x + bounds.width / 2);
      if (mode === 'top') dy = frame.y - bounds.y;
      if (mode === 'bottom') dy = frame.y + frame.height - (bounds.y + bounds.height);
      if (mode === 'centerY') dy = frame.y + frame.height / 2 - (bounds.y + bounds.height / 2);
      if (dx === 0 && dy === 0) continue;
      const transform = applyCanvasMatrix(content, node, translationMatrix(dx, dy));
      store.updateAttrs(id, { transform: transform || null });
    }
  };

  return (
    <div className="flex gap-0.5 mt-2">
      {ALIGN_BUTTONS.map((b) => (
        <button
          key={b.id}
          onClick={() => align(b.id)}
          disabled={selection.length === 0}
          className="tool-btn !w-7 !h-7 disabled:opacity-25 disabled:pointer-events-none"
          title={b.title}
        >
          <Icon name={b.icon} size={13} />
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PaintSection() {
  const selection = useSvgStore((s) => s.selection);
  const nodes = useSvgStore((s) => s.nodes);
  const updateManyAttrs = useSvgStore((s) => s.updateManyAttrs);
  const pushHistory = useSvgStore((s) => s.pushHistory);

  const first = nodes[selection[0]];
  if (!first) return null;

  const attr = (key: string, fallback = '') => {
    const values = selection.map((id) => nodes[id]?.attrs[key]);
    const unique = new Set(values);
    return unique.size === 1 ? (values[0] ?? fallback) : (values[0] ?? fallback);
  };

  const set = (patch: Record<string, string | null>) => {
    pushHistory();
    updateManyAttrs(selection, patch);
  };

  const strokeWidth = parseFloat(attr('stroke-width', '1')) || 0;
  const opacity = attr('opacity') ? parseFloat(attr('opacity')) : 1;
  const fillOpacity = attr('fill-opacity') ? parseFloat(attr('fill-opacity')) : 1;
  const dash = attr('stroke-dasharray');

  return (
    <Section title="Заливка и обводка">
      <ColorField label="Заливка" value={attr('fill', '#000000')} onChange={(v) => set({ fill: v })} />
      <Slider
        label="Прозрачность заливки"
        value={fillOpacity}
        min={0}
        max={1}
        onChange={(v) => set({ 'fill-opacity': v === 1 ? null : String(round(v)) })}
        resetTo={1}
        format={(v) => `${Math.round(v * 100)}%`}
      />

      <div className="h-px bg-border my-2" />

      <ColorField label="Обводка" value={attr('stroke', 'none')} onChange={(v) => set({ stroke: v })} />
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        <NumberField
          label="Т"
          value={strokeWidth}
          step={0.5}
          min={0}
          onChange={(v) => set({ 'stroke-width': v > 0 ? String(v) : null })}
        />
        <select
          value={attr('stroke-linecap', 'butt')}
          onChange={(e) => set({ 'stroke-linecap': e.target.value === 'butt' ? null : e.target.value })}
          className="num-input"
        >
          <option value="butt">Срез</option>
          <option value="round">Скругл.</option>
          <option value="square">Квадрат</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <select
          value={attr('stroke-linejoin', 'miter')}
          onChange={(e) => set({ 'stroke-linejoin': e.target.value === 'miter' ? null : e.target.value })}
          className="num-input"
        >
          <option value="miter">Угол</option>
          <option value="round">Скругл.</option>
          <option value="bevel">Фаска</option>
        </select>
        <input
          type="text"
          value={dash}
          placeholder="пунктир"
          onChange={(e) => set({ 'stroke-dasharray': e.target.value || null })}
          className="num-input"
          title="stroke-dasharray, например: 6 4"
        />
      </div>

      <div className="h-px bg-border my-2" />

      <Slider
        label="Непрозрачность"
        value={opacity}
        min={0}
        max={1}
        onChange={(v) => set({ opacity: v === 1 ? null : String(round(v)) })}
        resetTo={1}
        format={(v) => `${Math.round(v * 100)}%`}
      />

      {first.tag === 'rect' && (
        <div className="mt-1.5">
          <NumberField
            label="R"
            value={parseFloat(attr('rx', '0')) || 0}
            min={0}
            onChange={(v) => set({ rx: v > 0 ? String(v) : null, ry: v > 0 ? String(v) : null })}
          />
        </div>
      )}
    </Section>
  );
}

function TextSection() {
  const selection = useSvgStore((s) => s.selection);
  const nodes = useSvgStore((s) => s.nodes);
  const updateManyAttrs = useSvgStore((s) => s.updateManyAttrs);
  const updateNode = useSvgStore((s) => s.updateNode);
  const pushHistory = useSvgStore((s) => s.pushHistory);
  const node = nodes[selection[0]];
  if (!node) return null;

  const set = (patch: Record<string, string | null>) => {
    pushHistory();
    updateManyAttrs(selection, patch);
  };

  return (
    <Section title="Текст">
      <input
        type="text"
        value={stripTags(node.text ?? '')}
        onChange={(e) => updateNode(node.id, { text: escapeText(e.target.value) })}
        className="num-input mb-1.5"
        placeholder="Содержимое"
      />
      <div className="grid grid-cols-2 gap-1.5">
        <NumberField
          label="Кг"
          value={parseFloat(node.attrs['font-size'] ?? '16') || 16}
          onChange={(v) => set({ 'font-size': String(v) })}
          min={1}
        />
        <select
          value={node.attrs['font-weight'] ?? '400'}
          onChange={(e) => set({ 'font-weight': e.target.value })}
          className="num-input"
        >
          {['300', '400', '500', '600', '700', '800'].map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>
      </div>
      <input
        type="text"
        value={node.attrs['font-family'] ?? ''}
        onChange={(e) => set({ 'font-family': e.target.value || null })}
        className="num-input mt-1.5"
        placeholder="Гарнитура"
      />
      <div className="mt-1.5">
        <select
          value={node.attrs['text-anchor'] ?? 'start'}
          onChange={(e) => set({ 'text-anchor': e.target.value === 'start' ? null : e.target.value })}
          className="num-input"
        >
          <option value="start">Слева</option>
          <option value="middle">По центру</option>
          <option value="end">Справа</option>
        </select>
      </div>
    </Section>
  );
}

function ArrangeSection() {
  const selection = useSvgStore((s) => s.selection);

  const distribute = (axis: 'x' | 'y') => {
    const content = getContentGroup();
    if (!content) return;
    const store = useSvgStore.getState();
    const entries = store.selection
      .map((id) => {
        const el = findElement(content, id);
        const bounds = el ? boundsOf(content, el) : null;
        return bounds ? { id, bounds } : null;
      })
      .filter((x): x is { id: string; bounds: Rect } => Boolean(x));
    if (entries.length < 3) return;

    entries.sort((a, b) => (axis === 'x' ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y));
    const firstEdge = axis === 'x' ? entries[0].bounds.x : entries[0].bounds.y;
    const last = entries[entries.length - 1].bounds;
    const lastEdge = axis === 'x' ? last.x : last.y;
    const step = (lastEdge - firstEdge) / (entries.length - 1);

    store.pushHistory();
    entries.forEach(({ id, bounds }, i) => {
      if (i === 0 || i === entries.length - 1) return;
      const node = store.nodes[id];
      if (!node || node.locked) return;
      const target = firstEdge + step * i;
      const dx = axis === 'x' ? target - bounds.x : 0;
      const dy = axis === 'y' ? target - bounds.y : 0;
      const transform = applyCanvasMatrix(content, node, translationMatrix(dx, dy));
      store.updateAttrs(id, { transform: transform || null });
    });
  };

  return (
    <Section title="Распределение">
      <Row>
        <button
          onClick={() => distribute('x')}
          disabled={selection.length < 3}
          className="tool-btn !w-7 !h-7 disabled:opacity-25 disabled:pointer-events-none"
          title="Распределить по горизонтали"
        >
          <Icon name="distributeX" size={13} />
        </button>
        <button
          onClick={() => distribute('y')}
          disabled={selection.length < 3}
          className="tool-btn !w-7 !h-7 disabled:opacity-25 disabled:pointer-events-none"
          title="Распределить по вертикали"
        >
          <Icon name="distributeY" size={13} />
        </button>
        <span className="text-[10px] text-gray-600 ml-1">нужно 3+ объекта</span>
      </Row>
    </Section>
  );
}

const BOOL_OPS: { op: BooleanOp; icon: IconName; title: string }[] = [
  { op: 'union', icon: 'boolUnion', title: 'Объединить' },
  { op: 'subtract', icon: 'boolSubtract', title: 'Вычесть' },
  { op: 'intersect', icon: 'boolIntersect', title: 'Пересечь' },
  { op: 'exclude', icon: 'boolExclude', title: 'Исключить' },
];

function BooleanSection() {
  const showToast = useAppStore((s) => s.showToast);

  const run = (op: BooleanOp) => {
    const content = getContentGroup();
    if (!content) return;
    const store = useSvgStore.getState();

    // Bottom-to-top order matters: subtract removes the upper shapes from the
    // lowest one, which is what every vector editor does.
    const ordered = store.order.filter((id) => store.selection.includes(id));
    const polygons = [];
    for (const id of ordered) {
      const node = store.nodes[id];
      const d = node ? nodeToPathData(node) : null;
      if (!node || d === null) continue;
      const el = findElement(content, id);
      const frame = el ? frameOf(content, el) : null;
      polygons.push(pathToPolygons(d, frame?.matrix ?? new DOMMatrix()));
    }
    if (polygons.length < 2) {
      showToast('Нужны минимум две фигуры с контуром', 'error');
      return;
    }

    const d = booleanPaths(op, polygons);
    if (!d) {
      showToast('Операция не дала результата', 'error');
      return;
    }

    const base = store.nodes[ordered[0]];
    store.pushHistory();
    store.deleteNodes(ordered);
    const id = store.addNode({
      tag: 'path',
      attrs: {
        d,
        fill: base?.attrs.fill ?? '#000000',
        ...(base?.attrs.stroke ? { stroke: base.attrs.stroke } : {}),
        ...(base?.attrs['stroke-width'] ? { 'stroke-width': base.attrs['stroke-width'] } : {}),
        'fill-rule': 'evenodd',
      },
      name: 'Результат',
    });
    store.select([id]);
  };

  return (
    <Section title="Булевы операции">
      <Row>
        {BOOL_OPS.map((b) => (
          <button key={b.op} onClick={() => run(b.op)} className="tool-btn !w-8 !h-8" title={b.title}>
            <Icon name={b.icon} size={14} />
          </button>
        ))}
      </Row>
      <p className="text-[10px] text-gray-600 leading-snug mt-1.5">
        Кривые превращаются в полигоны — это неизбежно при булевых операциях.
      </p>
    </Section>
  );
}

function AttributesSection() {
  const selection = useSvgStore((s) => s.selection);
  const nodes = useSvgStore((s) => s.nodes);
  const updateAttrs = useSvgStore((s) => s.updateAttrs);
  const node = nodes[selection[0]];
  if (!node) return null;

  const entries = Object.entries(node.attrs).filter(([k]) => k !== 'transform');

  return (
    <Section title={`Атрибуты · <${node.tag}>`} defaultOpen={false}>
      {entries.length === 0 && <p className="text-[10px] text-gray-600">Нет атрибутов</p>}
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-center gap-1.5 mb-1">
          <span className="text-[10px] text-gray-500 w-20 shrink-0 truncate font-mono" title={key}>{key}</span>
          <input
            type="text"
            value={value}
            onChange={(e) => updateAttrs(node.id, { [key]: e.target.value })}
            className="num-input flex-1 min-w-0"
            spellCheck={false}
          />
        </div>
      ))}
      {node.attrs.transform && (
        <p className="text-[10px] text-gray-600 font-mono mt-1.5 break-all">
          transform: {node.attrs.transform}
        </p>
      )}
    </Section>
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stripTags(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent ?? '';
}
