import { create } from 'zustand';
import {
  DEFAULT_EXPORT,
  type ExportSettings,
  type SvgCanvas,
  type SvgDocument,
  type SvgNode,
  type Underlay,
} from '../types';
import { nextNodeId, type ParsedSvg } from './parse';

export type SvgTool =
  | 'select' | 'node' | 'pen' | 'pencil'
  | 'rect' | 'ellipse' | 'line' | 'polygon' | 'star' | 'text' | 'pan';

export interface ShapeDefaults {
  fill: string;
  stroke: string;
  strokeWidth: number;
  polygonSides: number;
  starPoints: number;
  starInner: number;
  fontSize: number;
  fontFamily: string;
}

interface Snapshot {
  canvas: SvgCanvas;
  defs: string;
  order: string[];
  nodes: Record<string, SvgNode>;
  selection: string[];
  underlay: Underlay | null;
}

/** Where a dragged layer lands, in paint-order terms. */
export type DropPosition = 'before' | 'after' | 'inside';

const HISTORY_LIMIT = 80;

interface SvgState {
  canvas: SvgCanvas;
  rootAttrs: Record<string, string>;
  defs: string;
  order: string[];
  nodes: Record<string, SvgNode>;
  sourcePath?: string;
  /** Reference image behind the artboard; never exported. */
  underlay: Underlay | null;
  /** `imgfile://` URL for the underlay, resolved at load time. */
  underlayUrl: string | null;

  selection: string[];
  /** Node whose anchors are being edited by the node tool. */
  editing: string | null;
  selectedAnchors: number[];
  hovered: string | null;

  tool: SvgTool;
  zoom: number;
  panX: number;
  panY: number;

  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
  snapToObjects: boolean;
  showRulers: boolean;
  /** Draw a checkerboard behind the artboard instead of a flat colour. */
  transparentBg: boolean;

  defaults: ShapeDefaults;
  exportSettings: ExportSettings;

  past: Snapshot[];
  future: Snapshot[];

  loadDocument: (doc: SvgDocument) => void;
  replaceContent: (parsed: ParsedSvg) => void;
  reset: () => void;

  setTool: (tool: SvgTool) => void;
  setView: (zoom: number, panX: number, panY: number) => void;
  setZoom: (zoom: number) => void;
  setCanvas: (patch: Partial<SvgCanvas>) => void;
  toggleFlag: (key: 'showGrid' | 'snapToGrid' | 'snapToObjects' | 'showRulers' | 'transparentBg') => void;
  setGridSize: (size: number) => void;
  setDefaults: (patch: Partial<ShapeDefaults>) => void;
  setExportSettings: (patch: Partial<ExportSettings>) => void;
  setDefs: (defs: string) => void;

  select: (ids: string[]) => void;
  addToSelection: (ids: string[]) => void;
  toggleSelection: (id: string) => void;
  clearSelection: () => void;
  selectAll: () => void;
  setHovered: (id: string | null) => void;
  setEditing: (id: string | null) => void;
  setSelectedAnchors: (indices: number[]) => void;

  addNode: (node: Omit<SvgNode, 'id'> & { id?: string }, parentId?: string | null) => string;
  updateAttrs: (id: string, attrs: Record<string, string | null>) => void;
  updateManyAttrs: (ids: string[], attrs: Record<string, string | null>) => void;
  updateNode: (id: string, patch: Partial<SvgNode>) => void;
  deleteNodes: (ids: string[]) => void;
  duplicateNodes: (ids: string[], offset?: number) => string[];
  insertNodes: (nodes: SvgNode[], topLevel: string[]) => string[];

  reorder: (ids: string[], where: 'front' | 'back' | 'forward' | 'backward') => void;
  moveNodes: (ids: string[], targetId: string | null, position: DropPosition) => boolean;
  group: (ids: string[]) => string | null;
  ungroup: (ids: string[]) => void;

  setUnderlay: (underlay: Underlay | null, url: string | null) => void;
  updateUnderlay: (patch: Partial<Underlay>) => void;
  /** Inserts a parsed SVG as one group; returns the new group's id. */
  insertParsed: (parsed: ParsedSvg, transform: string | null, name: string) => string;

  replaceColor: (from: string, to: string) => number;

  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
}

function snapshot(s: SvgState): Snapshot {
  return {
    canvas: s.canvas,
    defs: s.defs,
    order: [...s.order],
    nodes: { ...s.nodes },
    selection: [...s.selection],
    underlay: s.underlay,
  };
}

const EMPTY_CANVAS: SvgCanvas = { width: 512, height: 512, viewBox: [0, 0, 512, 512] };

export const DEFAULT_SHAPE_DEFAULTS: ShapeDefaults = {
  fill: '#7c5cff',
  stroke: 'none',
  strokeWidth: 2,
  polygonSides: 6,
  starPoints: 5,
  starInner: 0.45,
  fontSize: 32,
  fontFamily: 'Inter, -apple-system, sans-serif',
};

/** Maps every node to its parent (null = top level). Rebuilt on demand — the
 *  trees here are small enough that caching would cost more than it saves. */
export function buildParentMap(nodes: Record<string, SvgNode>): Record<string, string | null> {
  const parents: Record<string, string | null> = {};
  for (const node of Object.values(nodes)) {
    if (!node.children) continue;
    for (const child of node.children) parents[child] = node.id;
  }
  return parents;
}

/** All descendants of a node, itself included. */
export function collectSubtree(id: string, nodes: Record<string, SvgNode>, out: string[] = []): string[] {
  out.push(id);
  const node = nodes[id];
  if (node?.children) for (const child of node.children) collectSubtree(child, nodes, out);
  return out;
}

/** Flat list in paint order — the layers panel and z-order commands use it. */
export function flattenOrder(order: string[], nodes: Record<string, SvgNode>): string[] {
  const out: string[] = [];
  const walk = (ids: string[]) => {
    for (const id of ids) {
      out.push(id);
      const node = nodes[id];
      if (node?.children) walk(node.children);
    }
  };
  walk(order);
  return out;
}

export const useSvgStore = create<SvgState>((set, get) => ({
  canvas: EMPTY_CANVAS,
  rootAttrs: {},
  defs: '',
  order: [],
  nodes: {},
  underlay: null,
  underlayUrl: null,

  selection: [],
  editing: null,
  selectedAnchors: [],
  hovered: null,

  tool: 'select',
  zoom: 1,
  panX: 0,
  panY: 0,

  showGrid: false,
  snapToGrid: false,
  gridSize: 8,
  snapToObjects: true,
  showRulers: true,
  transparentBg: true,

  defaults: { ...DEFAULT_SHAPE_DEFAULTS },
  exportSettings: { ...DEFAULT_EXPORT, format: 'svg' },

  past: [],
  future: [],

  loadDocument: (doc) =>
    set({
      canvas: doc.canvas,
      rootAttrs: doc.rootAttrs,
      defs: doc.defs,
      order: doc.order,
      nodes: doc.nodes,
      sourcePath: doc.sourcePath,
      underlay: doc.underlay ?? null,
      underlayUrl: null,
      exportSettings: { ...DEFAULT_EXPORT, ...doc.exportSettings },
      zoom: doc.ui.zoom || 1,
      panX: doc.ui.panX,
      panY: doc.ui.panY,
      selection: [],
      editing: null,
      selectedAnchors: [],
      past: [],
      future: [],
      tool: 'select',
    }),

  replaceContent: (parsed) => {
    get().pushHistory();
    set({
      canvas: parsed.canvas,
      rootAttrs: parsed.rootAttrs,
      defs: parsed.defs,
      order: parsed.order,
      nodes: parsed.nodes,
      selection: [],
      editing: null,
      selectedAnchors: [],
    });
  },

  reset: () =>
    set({
      canvas: EMPTY_CANVAS, rootAttrs: {}, defs: '', order: [], nodes: {},
      selection: [], editing: null, selectedAnchors: [], past: [], future: [],
      underlay: null, underlayUrl: null,
    }),

  setTool: (tool) =>
    set((s) => ({
      tool,
      editing: tool === 'node' ? s.editing ?? s.selection[0] ?? null : null,
      selectedAnchors: [],
    })),
  setView: (zoom, panX, panY) => set({ zoom, panX, panY }),
  setZoom: (zoom) => set({ zoom: Math.min(64, Math.max(0.02, zoom)) }),
  setCanvas: (patch) => {
    get().pushHistory();
    set((s) => ({ canvas: { ...s.canvas, ...patch } }));
  },
  toggleFlag: (key) => set((s) => ({ [key]: !s[key] }) as Partial<SvgState>),
  setGridSize: (gridSize) => set({ gridSize: Math.max(1, gridSize) }),
  setDefaults: (patch) => set((s) => ({ defaults: { ...s.defaults, ...patch } })),
  setExportSettings: (patch) => set((s) => ({ exportSettings: { ...s.exportSettings, ...patch } })),
  setDefs: (defs) => {
    get().pushHistory();
    set({ defs });
  },

  select: (ids) => set({ selection: ids, selectedAnchors: [] }),
  addToSelection: (ids) =>
    set((s) => ({ selection: Array.from(new Set([...s.selection, ...ids])) })),
  toggleSelection: (id) =>
    set((s) => ({
      selection: s.selection.includes(id)
        ? s.selection.filter((x) => x !== id)
        : [...s.selection, id],
    })),
  clearSelection: () => set({ selection: [], editing: null, selectedAnchors: [] }),
  selectAll: () => set((s) => ({ selection: [...s.order] })),
  setHovered: (hovered) => set({ hovered }),
  setEditing: (editing) => set({ editing, selectedAnchors: [] }),
  setSelectedAnchors: (selectedAnchors) => set({ selectedAnchors }),

  addNode: (node, parentId = null) => {
    get().pushHistory();
    const id = node.id ?? nextNodeId();
    const full: SvgNode = { ...node, id };
    set((s) => {
      const nodes = { ...s.nodes, [id]: full };
      if (parentId && nodes[parentId]) {
        const parent = nodes[parentId];
        nodes[parentId] = { ...parent, children: [...(parent.children ?? []), id] };
        return { nodes };
      }
      return { nodes, order: [...s.order, id] };
    });
    return id;
  },

  updateAttrs: (id, attrs) => {
    set((s) => {
      const node = s.nodes[id];
      if (!node) return {};
      const next = { ...node.attrs };
      for (const [key, value] of Object.entries(attrs)) {
        if (value === null || value === '') delete next[key];
        else next[key] = value;
      }
      return { nodes: { ...s.nodes, [id]: { ...node, attrs: next } } };
    });
  },

  updateManyAttrs: (ids, attrs) => {
    set((s) => {
      const nodes = { ...s.nodes };
      for (const id of ids) {
        const node = nodes[id];
        if (!node) continue;
        const next = { ...node.attrs };
        for (const [key, value] of Object.entries(attrs)) {
          if (value === null || value === '') delete next[key];
          else next[key] = value;
        }
        nodes[id] = { ...node, attrs: next };
      }
      return { nodes };
    });
  },

  updateNode: (id, patch) =>
    set((s) => {
      const node = s.nodes[id];
      if (!node) return {};
      return { nodes: { ...s.nodes, [id]: { ...node, ...patch } } };
    }),

  deleteNodes: (ids) => {
    if (ids.length === 0) return;
    get().pushHistory();
    set((s) => {
      const nodes = { ...s.nodes };
      const doomed = new Set<string>();
      for (const id of ids) collectSubtree(id, nodes).forEach((x) => doomed.add(x));
      for (const id of doomed) delete nodes[id];

      // Drop the ids from wherever they were referenced.
      for (const node of Object.values(nodes)) {
        if (!node.children) continue;
        const kept = node.children.filter((c) => !doomed.has(c));
        if (kept.length !== node.children.length) nodes[node.id] = { ...node, children: kept };
      }
      return {
        nodes,
        order: s.order.filter((id) => !doomed.has(id)),
        selection: s.selection.filter((id) => !doomed.has(id)),
        editing: s.editing && doomed.has(s.editing) ? null : s.editing,
      };
    });
  },

  duplicateNodes: (ids, offset = 12) => {
    if (ids.length === 0) return [];
    get().pushHistory();
    const created: string[] = [];
    set((s) => {
      const nodes = { ...s.nodes };
      const order = [...s.order];
      const parents = buildParentMap(s.nodes);

      const cloneTree = (id: string): string | null => {
        const node = nodes[id];
        if (!node) return null;
        const newId = nextNodeId();
        const attrs = { ...node.attrs };
        delete attrs.id; // ids must stay unique in the output file
        const copy: SvgNode = { ...node, id: newId, attrs };
        if (node.children) {
          copy.children = node.children.map(cloneTree).filter((x): x is string => Boolean(x));
        }
        nodes[newId] = copy;
        return newId;
      };

      for (const id of ids) {
        const newId = cloneTree(id);
        if (!newId) continue;
        // Nudge the copy so it's visible instead of hiding under the original.
        const existing = nodes[newId].attrs.transform ?? '';
        nodes[newId] = {
          ...nodes[newId],
          attrs: {
            ...nodes[newId].attrs,
            transform: `translate(${offset} ${offset})${existing ? ` ${existing}` : ''}`,
          },
        };
        created.push(newId);

        const parentId = parents[id];
        if (parentId && nodes[parentId]) {
          const parent = nodes[parentId];
          nodes[parentId] = { ...parent, children: [...(parent.children ?? []), newId] };
        } else {
          order.push(newId);
        }
      }
      return { nodes, order, selection: created };
    });
    return created;
  },

  insertNodes: (incoming, topLevel) => {
    if (incoming.length === 0) return [];
    get().pushHistory();
    set((s) => {
      const nodes = { ...s.nodes };
      for (const node of incoming) nodes[node.id] = node;
      return { nodes, order: [...s.order, ...topLevel], selection: topLevel };
    });
    return topLevel;
  },

  reorder: (ids, where) => {
    if (ids.length === 0) return;
    get().pushHistory();
    set((s) => {
      const parents = buildParentMap(s.nodes);
      const nodes = { ...s.nodes };
      let order = [...s.order];

      // Each node moves within its own sibling list.
      const groups = new Map<string | null, string[]>();
      for (const id of ids) {
        const parent = parents[id] ?? null;
        groups.set(parent, [...(groups.get(parent) ?? []), id]);
      }

      for (const [parentId, members] of groups) {
        const siblings = parentId ? [...(nodes[parentId].children ?? [])] : order;
        const moving = members.filter((id) => siblings.includes(id));
        if (moving.length === 0) continue;

        let next: string[];
        if (where === 'front') {
          next = [...siblings.filter((id) => !moving.includes(id)), ...moving];
        } else if (where === 'back') {
          next = [...moving, ...siblings.filter((id) => !moving.includes(id))];
        } else {
          next = [...siblings];
          const step = where === 'forward' ? 1 : -1;
          // Walk from the leading edge so a multi-selection keeps its order.
          const indices = moving
            .map((id) => next.indexOf(id))
            .sort((a, b) => (step > 0 ? b - a : a - b));
          for (const idx of indices) {
            const target = idx + step;
            if (target < 0 || target >= next.length) continue;
            [next[idx], next[target]] = [next[target], next[idx]];
          }
        }

        if (parentId) nodes[parentId] = { ...nodes[parentId], children: next };
        else order = next;
      }
      return { nodes, order };
    });
  },

  /**
   * Drag-and-drop reordering. `position` is expressed in **paint order**, so
   * 'after' means "later in the file", i.e. drawn on top. The layers panel
   * shows the list reversed and flips this itself.
   *
   * Returns false when the move is impossible (dropping a group into its own
   * descendant), so the caller can skip the transform compensation.
   */
  moveNodes: (ids, targetId, position) => {
    const s = get();
    const moving = ids.filter((id) => s.nodes[id]);
    if (moving.length === 0) return false;

    // A node can't become its own descendant.
    if (targetId) {
      const insideMoving = new Set(moving.flatMap((id) => collectSubtree(id, s.nodes)));
      if (insideMoving.has(targetId)) return false;
    }
    if (position === 'inside' && targetId && !s.nodes[targetId]?.children) return false;

    get().pushHistory();
    set((state) => {
      const nodes = { ...state.nodes };
      const doomed = new Set(moving);

      // Keep the dragged nodes in their existing relative paint order.
      const flat = flattenOrder(state.order, state.nodes);
      const ordered = [...moving].sort((a, b) => flat.indexOf(a) - flat.indexOf(b));

      // Detach.
      let order = state.order.filter((id) => !doomed.has(id));
      for (const node of Object.values(nodes)) {
        if (!node.children) continue;
        const kept = node.children.filter((c) => !doomed.has(c));
        if (kept.length !== node.children.length) nodes[node.id] = { ...node, children: kept };
      }

      // Resolve the destination *after* detaching, so indices already account
      // for the gap the dragged nodes left behind.
      let containerId: string | null = null;
      let index: number;

      if (position === 'inside' && targetId) {
        containerId = targetId;
        index = (nodes[targetId].children ?? []).length;
      } else if (targetId) {
        const parents = buildParentMap(nodes);
        containerId = parents[targetId] ?? null;
        const list = containerId ? (nodes[containerId].children ?? []) : order;
        const at = list.indexOf(targetId);
        index = at < 0 ? list.length : position === 'after' ? at + 1 : at;
      } else {
        index = order.length;
      }

      if (containerId) {
        const list = [...(nodes[containerId].children ?? [])];
        list.splice(index, 0, ...ordered);
        nodes[containerId] = { ...nodes[containerId], children: list };
      } else {
        order = [...order.slice(0, index), ...ordered, ...order.slice(index)];
      }

      return { nodes, order, selection: ordered };
    });
    return true;
  },

  setUnderlay: (underlay, url) => {
    get().pushHistory();
    set({ underlay, underlayUrl: url });
  },

  updateUnderlay: (patch) =>
    set((s) => (s.underlay ? { underlay: { ...s.underlay, ...patch } } : {})),

  /**
   * Drops a parsed SVG in as a single group. Incoming `id` attributes are
   * renamed when they would collide with ids already in the document —
   * otherwise a traced or pasted graphic could silently hijack an existing
   * gradient or clip-path reference.
   */
  insertParsed: (parsed, transform, name) => {
    get().pushHistory();
    const groupId = nextNodeId();

    set((s) => {
      const existingIds = new Set<string>();
      for (const node of Object.values(s.nodes)) {
        if (node.attrs.id) existingIds.add(node.attrs.id);
      }
      for (const m of s.defs.matchAll(/\bid="([^"]+)"/g)) existingIds.add(m[1]);

      const renames = new Map<string, string>();
      for (const node of Object.values(parsed.nodes)) {
        const id = node.attrs.id;
        if (id && existingIds.has(id)) renames.set(id, `${id}-${groupId.slice(0, 5)}`);
      }
      for (const m of parsed.defs.matchAll(/\bid="([^"]+)"/g)) {
        if (existingIds.has(m[1])) renames.set(m[1], `${m[1]}-${groupId.slice(0, 5)}`);
      }

      const rewrite = (value: string): string => {
        let out = value;
        for (const [from, to] of renames) {
          out = out
            .replaceAll(`url(#${from})`, `url(#${to})`)
            .replaceAll(`href="#${from}"`, `href="#${to}"`)
            .replaceAll(`id="${from}"`, `id="${to}"`);
        }
        return out;
      };

      const nodes = { ...s.nodes };
      for (const node of Object.values(parsed.nodes)) {
        const attrs = { ...node.attrs };
        if (renames.size > 0) {
          if (attrs.id && renames.has(attrs.id)) attrs.id = renames.get(attrs.id)!;
          for (const [key, value] of Object.entries(attrs)) {
            if (value.includes('url(#') || value.startsWith('#')) attrs[key] = rewrite(value);
          }
        }
        nodes[node.id] = { ...node, attrs };
      }

      nodes[groupId] = {
        id: groupId,
        tag: 'g',
        attrs: transform ? { transform } : {},
        children: parsed.order,
        name,
      };

      const incomingDefs = renames.size > 0 ? rewrite(parsed.defs) : parsed.defs;
      const defs = [s.defs, incomingDefs].filter((d) => d.trim()).join('\n');

      return { nodes, defs, order: [...s.order, groupId], selection: [groupId] };
    });

    return groupId;
  },

  group: (ids) => {
    if (ids.length < 2) return null;
    get().pushHistory();
    const groupId = nextNodeId();
    set((s) => {
      const parents = buildParentMap(s.nodes);
      const nodes = { ...s.nodes };
      // Group where the topmost member sits, keeping paint order sane.
      const flat = flattenOrder(s.order, s.nodes);
      const members = [...ids].sort((a, b) => flat.indexOf(a) - flat.indexOf(b));

      const parentId = parents[members[0]] ?? null;
      const anchorList = parentId ? [...(nodes[parentId].children ?? [])] : [...s.order];
      const insertAt = Math.max(0, ...members.map((id) => anchorList.indexOf(id)).filter((i) => i >= 0));

      nodes[groupId] = { id: groupId, tag: 'g', attrs: {}, children: members, name: 'Группа' };

      // Detach members from wherever they were.
      for (const node of Object.values(nodes)) {
        if (!node.children || node.id === groupId) continue;
        const kept = node.children.filter((c) => !members.includes(c));
        if (kept.length !== node.children.length) nodes[node.id] = { ...node, children: kept };
      }

      let order = s.order.filter((id) => !members.includes(id));
      if (parentId && nodes[parentId]) {
        const kids = [...(nodes[parentId].children ?? [])];
        kids.splice(Math.min(insertAt, kids.length), 0, groupId);
        nodes[parentId] = { ...nodes[parentId], children: kids };
      } else {
        const at = Math.min(insertAt, order.length);
        order = [...order.slice(0, at), groupId, ...order.slice(at)];
      }
      return { nodes, order, selection: [groupId] };
    });
    return groupId;
  },

  ungroup: (ids) => {
    const groups = ids.filter((id) => get().nodes[id]?.tag === 'g');
    if (groups.length === 0) return;
    get().pushHistory();
    set((s) => {
      const parents = buildParentMap(s.nodes);
      const nodes = { ...s.nodes };
      let order = [...s.order];
      const freed: string[] = [];

      for (const groupId of groups) {
        const group = nodes[groupId];
        if (!group?.children) continue;
        const kids = group.children;
        const groupTransform = group.attrs.transform;

        // The group's transform has to survive on each child.
        for (const kid of kids) {
          const node = nodes[kid];
          if (!node) continue;
          if (groupTransform) {
            const own = node.attrs.transform;
            nodes[kid] = {
              ...node,
              attrs: { ...node.attrs, transform: own ? `${groupTransform} ${own}` : groupTransform },
            };
          }
          freed.push(kid);
        }

        const parentId = parents[groupId] ?? null;
        if (parentId && nodes[parentId]) {
          const siblings = [...(nodes[parentId].children ?? [])];
          const at = siblings.indexOf(groupId);
          siblings.splice(at, 1, ...kids);
          nodes[parentId] = { ...nodes[parentId], children: siblings };
        } else {
          const at = order.indexOf(groupId);
          if (at >= 0) order.splice(at, 1, ...kids);
        }
        delete nodes[groupId];
      }
      return { nodes, order, selection: freed };
    });
  },

  /**
   * Swaps one colour for another everywhere it can appear: presentation
   * attributes, inline `style`, the preserved inner markup of leaf elements
   * (a `<tspan fill="…">` inside a `<text>` lives there), and the raw defs
   * block (gradient stops and `<style>` rules live there).
   */
  replaceColor: (from, to) => {
    const target = from.toLowerCase();
    const pattern = new RegExp(escapeRegExp(from), 'gi');
    let hits = 0;
    get().pushHistory();
    set((s) => {
      const nodes = { ...s.nodes };
      for (const node of Object.values(nodes)) {
        const attrs = { ...node.attrs };
        let touched = false;
        for (const key of ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color']) {
          if (attrs[key] && attrs[key].toLowerCase() === target) {
            attrs[key] = to;
            touched = true;
            hits += 1;
          }
        }
        if (attrs.style && attrs.style.toLowerCase().includes(target)) {
          attrs.style = attrs.style.replace(pattern, to);
          touched = true;
          hits += 1;
        }

        let text = node.text;
        if (text && text.toLowerCase().includes(target)) {
          text = text.replace(pattern, to);
          hits += 1;
          nodes[node.id] = { ...node, attrs, text };
          continue;
        }
        if (touched) nodes[node.id] = { ...node, attrs };
      }

      let defs = s.defs;
      if (defs.toLowerCase().includes(target)) {
        const before = defs;
        defs = defs.replace(pattern, to);
        if (defs !== before) hits += 1;
      }
      return { nodes, defs };
    });
    return hits;
  },

  pushHistory: () => {
    const s = get();
    const past = [...s.past, snapshot(s)];
    if (past.length > HISTORY_LIMIT) past.shift();
    set({ past, future: [] });
  },

  undo: () => {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev) return;
    set({
      past: s.past.slice(0, -1),
      future: [...s.future, snapshot(s)],
      canvas: prev.canvas,
      defs: prev.defs,
      order: prev.order,
      nodes: prev.nodes,
      selection: prev.selection.filter((id) => prev.nodes[id]),
      selectedAnchors: [],
      underlay: prev.underlay,
    });
  },

  redo: () => {
    const s = get();
    const next = s.future[s.future.length - 1];
    if (!next) return;
    set({
      future: s.future.slice(0, -1),
      past: [...s.past, snapshot(s)],
      canvas: next.canvas,
      defs: next.defs,
      order: next.order,
      nodes: next.nodes,
      selection: next.selection.filter((id) => next.nodes[id]),
      selectedAnchors: [],
      underlay: next.underlay,
    });
  },
}));

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Every literal colour used in the document, with its usage count. */
export function documentPalette(
  nodes: Record<string, SvgNode>,
  defs: string,
): { color: string; count: number }[] {
  const counts = new Map<string, number>();
  const bump = (raw: string | undefined) => {
    if (!raw) return;
    const value = raw.trim().toLowerCase();
    if (!value || value === 'none' || value === 'transparent' || value.startsWith('url(')) return;
    if (value === 'currentcolor' || value === 'inherit') return;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  };

  // Colours hide in four places: presentation attributes, inline style, the
  // preserved inner markup of leaf elements, and the raw defs block.
  const scanMarkup = (markup: string) => {
    for (const m of markup.matchAll(/(?:stop-color|fill|stroke)\s*[:=]\s*"?([#\w(),.%\s-]+)"?/gi)) {
      bump(m[1]);
    }
  };

  for (const node of Object.values(nodes)) {
    bump(node.attrs.fill);
    bump(node.attrs.stroke);
    bump(node.attrs['stop-color']);
    if (node.attrs.style) {
      for (const m of node.attrs.style.matchAll(/(?:fill|stroke|stop-color)\s*:\s*([^;]+)/gi)) {
        bump(m[1]);
      }
    }
    if (node.text) scanMarkup(node.text);
  }
  scanMarkup(defs);

  return [...counts.entries()]
    .map(([color, count]) => ({ color, count }))
    .sort((a, b) => b.count - a.count);
}
