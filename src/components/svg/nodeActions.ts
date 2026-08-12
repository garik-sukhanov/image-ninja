import { useSvgStore } from '../../svg/svgStore';
import { nodeToPathData, SHAPE_GEOMETRY_ATTRS } from '../../svg/path';
import type { MenuItem } from '../ContextMenu';

/** Turns primitives (rect, circle, polygon, …) into an equivalent `<path>`. */
export function convertToPath(ids: string[]): number {
  const store = useSvgStore.getState();
  const convertible = ids.filter((id) => {
    const node = store.nodes[id];
    return node && node.tag !== 'path' && node.tag !== 'g' && nodeToPathData(node) !== null;
  });
  if (convertible.length === 0) return 0;

  store.pushHistory();
  for (const id of convertible) {
    const node = useSvgStore.getState().nodes[id];
    const d = nodeToPathData(node);
    if (d === null) continue;
    const attrs: Record<string, string> = { ...node.attrs, d };
    for (const key of SHAPE_GEOMETRY_ATTRS) delete attrs[key];
    store.updateNode(id, { tag: 'path', attrs });
  }
  return convertible.length;
}

/**
 * The menu shown for a selection, shared by the canvas and the layers panel so
 * both offer exactly the same commands.
 */
export function nodeMenuItems(ids: string[]): MenuItem[] {
  const store = useSvgStore.getState();
  const has = ids.length > 0;
  const hasGroup = ids.some((id) => store.nodes[id]?.tag === 'g');
  const convertible = ids.some((id) => {
    const node = store.nodes[id];
    return node && node.tag !== 'path' && node.tag !== 'g' && nodeToPathData(node) !== null;
  });
  const allHidden = has && ids.every((id) => store.nodes[id]?.hidden);
  const allLocked = has && ids.every((id) => store.nodes[id]?.locked);

  return [
    { label: 'На слой выше', shortcut: '⌘]', disabled: !has, onSelect: () => store.reorder(ids, 'forward') },
    { label: 'На слой ниже', shortcut: '⌘[', disabled: !has, onSelect: () => store.reorder(ids, 'backward') },
    { label: 'На передний план', shortcut: '⇧⌘]', disabled: !has, onSelect: () => store.reorder(ids, 'front') },
    { label: 'На задний план', shortcut: '⇧⌘[', disabled: !has, onSelect: () => store.reorder(ids, 'back') },
    {},
    { label: 'Дублировать', shortcut: '⌘D', disabled: !has, onSelect: () => store.duplicateNodes(ids) },
    { label: 'Сгруппировать', shortcut: '⌘G', disabled: ids.length < 2, onSelect: () => store.group(ids) },
    { label: 'Разгруппировать', shortcut: '⇧⌘G', disabled: !hasGroup, onSelect: () => store.ungroup(ids) },
    { label: 'Преобразовать в контур', disabled: !convertible, onSelect: () => convertToPath(ids) },
    {},
    {
      label: allHidden ? 'Показать' : 'Скрыть',
      disabled: !has,
      onSelect: () => {
        for (const id of ids) store.updateNode(id, { hidden: !allHidden });
      },
    },
    {
      label: allLocked ? 'Разблокировать' : 'Заблокировать',
      disabled: !has,
      onSelect: () => {
        for (const id of ids) store.updateNode(id, { locked: !allLocked });
      },
    },
    {},
    { label: 'Удалить', shortcut: '⌫', disabled: !has, danger: true, onSelect: () => store.deleteNodes(ids) },
  ];
}
