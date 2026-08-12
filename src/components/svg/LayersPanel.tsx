import { useState } from 'react';
import { useSvgStore } from '../../svg/svgStore';
import type { SvgNode } from '../../types';
import { Icon } from '../Icons';

const TAG_LABEL: Record<string, string> = {
  g: 'Группа', rect: 'Прямоугольник', circle: 'Круг', ellipse: 'Эллипс', line: 'Линия',
  polyline: 'Ломаная', polygon: 'Многоугольник', path: 'Контур', text: 'Текст',
  image: 'Картинка', use: 'Ссылка',
};

function labelFor(node: SvgNode): string {
  if (node.name) return node.name;
  if (node.attrs.id) return node.attrs.id;
  return TAG_LABEL[node.tag] ?? node.tag;
}

export function LayersPanel() {
  const order = useSvgStore((s) => s.order);
  const nodes = useSvgStore((s) => s.nodes);
  const selection = useSvgStore((s) => s.selection);

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex items-center justify-between px-3 h-8 border-b border-border shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-gray-400">Слои</span>
        <span className="text-[10px] text-gray-600">{order.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 py-1">
        {order.length === 0 ? (
          <p className="text-[10px] text-gray-600 px-3 py-4 text-center leading-relaxed">
            Пусто. Нарисуйте фигуру или перетащите SVG в окно.
          </p>
        ) : (
          // Paint order puts the last element on top, so show the list reversed.
          [...order].reverse().map((id) => (
            <LayerRow key={id} id={id} nodes={nodes} selection={selection} depth={0} />
          ))
        )}
      </div>

      <ZOrderBar />
    </div>
  );
}

function LayerRow({
  id, nodes, selection, depth,
}: { id: string; nodes: Record<string, SvgNode>; selection: string[]; depth: number }) {
  const node = nodes[id];
  const [expanded, setExpanded] = useState(depth < 1);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  if (!node) return null;

  const selected = selection.includes(id);
  const store = useSvgStore.getState();

  return (
    <>
      <div
        className={`group flex items-center gap-1 pr-2 h-6 cursor-pointer text-[11px] transition-colors ${
          selected ? 'bg-accent/15 text-accent' : 'text-gray-300 hover:bg-panel-3'
        }`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={(e) => {
          if (e.shiftKey) store.toggleSelection(id);
          else store.select([id]);
        }}
        onDoubleClick={() => { setRenaming(true); setDraft(labelFor(node)); }}
        onMouseEnter={() => store.setHovered(id)}
        onMouseLeave={() => store.setHovered(null)}
      >
        {node.children?.length ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            className="w-3 text-[7px] text-gray-500 shrink-0"
          >
            {expanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        <span className="w-3.5 shrink-0 opacity-60">
          <Icon name={iconFor(node.tag)} size={11} />
        </span>

        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => { store.updateNode(id, { name: draft.trim() || undefined }); setRenaming(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
            className="flex-1 min-w-0 bg-panel-3 border border-accent rounded px-1 outline-none text-[11px]"
          />
        ) : (
          <span className="flex-1 truncate" title={labelFor(node)}>{labelFor(node)}</span>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); store.updateNode(id, { locked: !node.locked }); }}
          className={`shrink-0 transition-opacity ${node.locked ? 'opacity-90 text-accent-2' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'}`}
          title={node.locked ? 'Разблокировать' : 'Заблокировать'}
        >
          <Icon name={node.locked ? 'lock' : 'unlock'} size={11} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); store.updateNode(id, { hidden: !node.hidden }); }}
          className={`shrink-0 transition-opacity ${node.hidden ? 'opacity-90' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'}`}
          title={node.hidden ? 'Показать' : 'Скрыть'}
        >
          <Icon name={node.hidden ? 'eyeOff' : 'eye'} size={11} />
        </button>
      </div>

      {expanded && node.children &&
        [...node.children].reverse().map((childId) => (
          <LayerRow key={childId} id={childId} nodes={nodes} selection={selection} depth={depth + 1} />
        ))}
    </>
  );
}

function iconFor(tag: string): Parameters<typeof Icon>[0]['name'] {
  switch (tag) {
    case 'g': return 'group';
    case 'rect': return 'rect';
    case 'circle': case 'ellipse': return 'ellipse';
    case 'line': return 'line';
    case 'polygon': case 'polyline': return 'polygon';
    case 'text': return 'text';
    case 'image': return 'image';
    default: return 'pen';
  }
}

function ZOrderBar() {
  const selection = useSvgStore((s) => s.selection);
  const reorder = useSvgStore((s) => s.reorder);
  const group = useSvgStore((s) => s.group);
  const ungroup = useSvgStore((s) => s.ungroup);
  const deleteNodes = useSvgStore((s) => s.deleteNodes);
  const has = selection.length > 0;

  const btn = 'p-1.5 rounded text-gray-400 hover:text-white hover:bg-panel-3 disabled:opacity-25 disabled:pointer-events-none transition-colors';

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-t border-border shrink-0">
      <button className={btn} disabled={!has} onClick={() => reorder(selection, 'front')} title="На передний план (Cmd+Shift+])">
        <Icon name="toFront" size={13} />
      </button>
      <button className={btn} disabled={!has} onClick={() => reorder(selection, 'forward')} title="Выше (Cmd+])">
        <Icon name="plus" size={13} />
      </button>
      <button className={btn} disabled={!has} onClick={() => reorder(selection, 'backward')} title="Ниже (Cmd+[)">
        <Icon name="minus" size={13} />
      </button>
      <button className={btn} disabled={!has} onClick={() => reorder(selection, 'back')} title="На задний план (Cmd+Shift+[)">
        <Icon name="toBack" size={13} />
      </button>

      <div className="w-px h-4 bg-border mx-1" />

      <button className={btn} disabled={selection.length < 2} onClick={() => group(selection)} title="Сгруппировать (Cmd+G)">
        <Icon name="group" size={13} />
      </button>
      <button className={btn} disabled={!has} onClick={() => ungroup(selection)} title="Разгруппировать (Cmd+Shift+G)">
        <Icon name="ungroup" size={13} />
      </button>

      <div className="flex-1" />

      <button
        className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-25 disabled:pointer-events-none transition-colors"
        disabled={!has}
        onClick={() => deleteNodes(selection)}
        title="Удалить (Delete)"
      >
        <Icon name="trash" size={13} />
      </button>
    </div>
  );
}
