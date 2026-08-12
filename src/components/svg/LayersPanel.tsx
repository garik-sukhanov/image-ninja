import { useCallback, useState } from 'react';
import { useSvgStore, buildParentMap, type DropPosition } from '../../svg/svgStore';
import { getContentGroup } from '../../svg/dom';
import { reparentTransform } from '../../svg/transform';
import type { SvgNode } from '../../types';
import { Icon } from '../Icons';
import { ContextMenu, useContextMenu } from '../ContextMenu';
import { nodeMenuItems } from './nodeActions';

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

/** Where a drag would land, in *visual* terms (the list is drawn top-down). */
interface DropHint {
  id: string | null;
  edge: 'above' | 'below' | 'inside';
}

export function LayersPanel() {
  const order = useSvgStore((s) => s.order);
  const nodes = useSvgStore((s) => s.nodes);
  const selection = useSvgStore((s) => s.selection);

  const [dragging, setDragging] = useState<string[]>([]);
  const [hint, setHint] = useState<DropHint | null>(null);
  const menu = useContextMenu();

  /**
   * Commits a drag. The panel lists layers top-down while the document stores
   * them in paint order, so "visually above" means "later in the file" — that
   * flip happens here and nowhere else.
   */
  const drop = useCallback((targetId: string | null, edge: DropHint['edge']) => {
    const ids = dragging;
    setDragging([]);
    setHint(null);
    if (ids.length === 0) return;

    const store = useSvgStore.getState();
    const position: DropPosition =
      edge === 'inside' ? 'inside' : edge === 'above' ? 'after' : 'before';

    const parents = buildParentMap(store.nodes);
    const newParent =
      position === 'inside' ? targetId : targetId ? (parents[targetId] ?? null) : null;

    // Compute the compensating transforms while the old placement is still on
    // screen, then apply them after the move so nothing visually shifts.
    const content = getContentGroup();
    const compensation: [string, string | null][] = [];
    if (content) {
      for (const id of ids) {
        if ((parents[id] ?? null) === newParent) continue;
        compensation.push([id, reparentTransform(content, id, newParent)]);
      }
    }

    if (!store.moveNodes(ids, targetId, position)) return;

    // No extra pushHistory here: moveNodes already snapshotted the state before
    // the move, so a single undo reverts both the move and the compensation.
    for (const [id, transform] of compensation) {
      useSvgStore.getState().updateAttrs(id, { transform: transform || null });
    }
  }, [dragging]);

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex items-center justify-between px-3 h-8 border-b border-border shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-gray-400">Слои</span>
        <span className="text-[10px] text-gray-600">{order.length}</span>
      </div>

      <div
        className="flex-1 overflow-y-auto min-h-0 py-1"
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('[data-layer-row]')) return;
          menu.open(e, nodeMenuItems(selection));
        }}
        onDragOver={(e) => {
          // Empty space below the list: drop onto the top of the stack.
          if ((e.target as HTMLElement).closest('[data-layer-row]')) return;
          e.preventDefault();
          setHint({ id: null, edge: 'above' });
        }}
        onDrop={(e) => {
          if ((e.target as HTMLElement).closest('[data-layer-row]')) return;
          e.preventDefault();
          drop(null, 'above');
        }}
      >
        {order.length === 0 ? (
          <p className="text-[10px] text-gray-600 px-3 py-4 text-center leading-relaxed">
            Пусто. Нарисуйте фигуру или перетащите SVG в окно.
          </p>
        ) : (
          [...order].reverse().map((id) => (
            <LayerRow
              key={id}
              id={id}
              nodes={nodes}
              selection={selection}
              depth={0}
              dragging={dragging}
              hint={hint}
              onDragStart={setDragging}
              onHint={setHint}
              onDrop={drop}
              onMenu={menu.open}
            />
          ))
        )}
        {hint?.id === null && (
          <div className="h-0.5 bg-accent mx-2 rounded" />
        )}
      </div>

      <ZOrderBar />
      {menu.anchor && <ContextMenu anchor={menu.anchor} onClose={menu.close} />}
    </div>
  );
}

interface RowProps {
  id: string;
  nodes: Record<string, SvgNode>;
  selection: string[];
  depth: number;
  dragging: string[];
  hint: DropHint | null;
  onDragStart: (ids: string[]) => void;
  onHint: (hint: DropHint | null) => void;
  onDrop: (targetId: string | null, edge: DropHint['edge']) => void;
  onMenu: (e: React.MouseEvent, items: ReturnType<typeof nodeMenuItems>) => void;
}

function LayerRow({
  id, nodes, selection, depth, dragging, hint, onDragStart, onHint, onDrop, onMenu,
}: RowProps) {
  const node = nodes[id];
  const [expanded, setExpanded] = useState(depth < 1);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  if (!node) return null;

  const selected = selection.includes(id);
  const isDragged = dragging.includes(id);
  const store = useSvgStore.getState();
  const isGroup = Boolean(node.children);
  const showHint = hint?.id === id;

  return (
    <>
      {showHint && hint.edge === 'above' && <DropLine depth={depth} />}
      <div
        data-layer-row={id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', id);
          // Dragging a selected row moves the whole selection.
          onDragStart(selection.includes(id) ? selection : [id]);
        }}
        onDragEnd={() => { onDragStart([]); onHint(null); }}
        onDragOver={(e) => {
          if (dragging.length === 0 || dragging.includes(id)) return;
          e.preventDefault();
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const t = (e.clientY - rect.top) / rect.height;
          // Groups get a middle band that drops *into* them.
          const edge = isGroup
            ? t < 0.3 ? 'above' : t > 0.7 ? 'below' : 'inside'
            : t < 0.5 ? 'above' : 'below';
          onHint({ id, edge });
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          if (hint?.id === id) onHint(null);
        }}
        onDrop={(e) => {
          if (dragging.length === 0 || dragging.includes(id)) return;
          e.preventDefault();
          e.stopPropagation();
          onDrop(id, hint?.id === id ? hint.edge : 'above');
        }}
        className={`group flex items-center gap-1 pr-2 h-6 cursor-pointer text-[11px] transition-colors ${
          isDragged ? 'opacity-40' : ''
        } ${
          showHint && hint.edge === 'inside' ? 'ring-1 ring-inset ring-accent bg-accent/10' : ''
        } ${
          selected ? 'bg-accent/15 text-accent' : 'text-gray-300 hover:bg-panel-3'
        }`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={(e) => {
          if (e.shiftKey) store.toggleSelection(id);
          else store.select([id]);
        }}
        onContextMenu={(e) => {
          e.stopPropagation();
          const target = selection.includes(id) ? selection : [id];
          if (!selection.includes(id)) store.select([id]);
          onMenu(e, nodeMenuItems(target));
        }}
        onDoubleClick={() => { setRenaming(true); setDraft(labelFor(node)); }}
        onMouseEnter={() => store.setHovered(id)}
        onMouseLeave={() => store.setHovered(null)}
      >
        {isGroup && node.children!.length > 0 ? (
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
      {showHint && hint.edge === 'below' && <DropLine depth={depth} />}

      {expanded && node.children &&
        [...node.children].reverse().map((childId) => (
          <LayerRow
            key={childId}
            id={childId}
            nodes={nodes}
            selection={selection}
            depth={depth + 1}
            dragging={dragging}
            hint={hint}
            onDragStart={onDragStart}
            onHint={onHint}
            onDrop={onDrop}
            onMenu={onMenu}
          />
        ))}
    </>
  );
}

function DropLine({ depth }: { depth: number }) {
  return (
    <div
      className="h-0.5 bg-accent rounded pointer-events-none"
      style={{ marginLeft: 8 + depth * 12, marginRight: 8 }}
    />
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
