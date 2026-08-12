import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSvgStore, buildParentMap, collectSubtree } from '../../svg/svgStore';
import {
  boundsOf, findElement, frameBounds, frameOf, normalizeRect, rectsIntersect,
  screenToCanvas, transformPoint, unionRects,
  type Frame, type Point, type Rect,
} from '../../svg/geometry';
import { applyCanvasMatrix, rotateAboutMatrix, scaleAboutMatrix, translationMatrix } from '../../svg/transform';
import {
  curvesToPathString, getAnchors, insertAnchorAt, makeCorner, makeSmooth, moveAnchor,
  moveHandle, nearestOnPath, nodeToPathData, toCurves, type Anchor, type Curves,
} from '../../svg/path';
import {
  DEFAULT_FREEHAND, makeEllipse, makeFreehand, makeLine, makePath, makePolygon,
  makeRect, makeStar, makeText, penAnchorsToPath, type PenAnchor,
} from '../../svg/shapes';
import { snapRect, type Guide } from '../../svg/snap';
import { CONTENT_GROUP_ID } from '../../svg/dom';
import { Scene } from './SceneRenderer';
import { ContextMenu, useContextMenu } from '../ContextMenu';
import { nodeMenuItems } from './nodeActions';
import { Guides, HANDLES, MarqueeBox, SelectionOverlay, HoverOutline, type HandleId } from './SelectionOverlay';
import { NodeOverlay, PenPreview } from './NodeOverlay';
import type { SvgNode } from '../../types';

const SNAP_PX = 6;

type Drag =
  | { kind: 'pan'; startClient: Point; startPan: Point }
  | { kind: 'marquee'; start: Point; current: Point; additive: boolean }
  | { kind: 'move'; start: Point; startNodes: Record<string, SvgNode>; startBounds: Rect }
  | { kind: 'resize'; handle: HandleId; frame: Frame; startNodes: Record<string, SvgNode> }
  | { kind: 'rotate'; center: Point; startAngle: number; startNodes: Record<string, SvgNode> }
  | { kind: 'anchor'; anchor: number; which: 'point' | 'in' | 'out'; startCurves: Curves; toLocal: DOMMatrix; start: Point }
  | { kind: 'draw'; start: Point; current: Point }
  | { kind: 'pencil'; points: [number, number, number][] }
  | { kind: 'underlay'; start: Point; origin: Point }
  | null;

export function SvgCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [frames, setFrames] = useState<Record<string, Frame>>({});
  const [guides, setGuides] = useState<Guide[]>([]);
  const [penAnchors, setPenAnchors] = useState<PenAnchor[]>([]);
  const [penPreview, setPenPreview] = useState<Point | null>(null);
  const [textEdit, setTextEdit] = useState<{ id: string; value: string } | null>(null);
  const dragRef = useRef<Drag>(null);
  const spaceHeld = useRef(false);

  const canvas = useSvgStore((s) => s.canvas);
  const nodes = useSvgStore((s) => s.nodes);
  const order = useSvgStore((s) => s.order);
  const defs = useSvgStore((s) => s.defs);
  const selection = useSvgStore((s) => s.selection);
  const hovered = useSvgStore((s) => s.hovered);
  const editing = useSvgStore((s) => s.editing);
  const selectedAnchors = useSvgStore((s) => s.selectedAnchors);
  const tool = useSvgStore((s) => s.tool);
  const zoom = useSvgStore((s) => s.zoom);
  const panX = useSvgStore((s) => s.panX);
  const panY = useSvgStore((s) => s.panY);
  const showGrid = useSvgStore((s) => s.showGrid);
  const gridSize = useSvgStore((s) => s.gridSize);
  const snapToGrid = useSvgStore((s) => s.snapToGrid);
  const snapToObjects = useSvgStore((s) => s.snapToObjects);
  const transparentBg = useSvgStore((s) => s.transparentBg);
  const underlay = useSvgStore((s) => s.underlay);
  const underlayUrl = useSvgStore((s) => s.underlayUrl);
  const menu = useContextMenu();

  const [vx, vy, vw, vh] = canvas.viewBox;

  // -------------------------------------------------------------------------
  // View transform: doc units ⇄ screen pixels
  // -------------------------------------------------------------------------

  const tx = size.w / 2 + panX - (vx + vw / 2) * zoom;
  const ty = size.h / 2 + panY - (vy + vh / 2) * zoom;

  const toScreen = useCallback(
    (x: number, y: number): Point => ({ x: tx + x * zoom, y: ty + y * zoom }),
    [tx, ty, zoom],
  );
  const toDoc = useCallback(
    (sx: number, sy: number): Point => ({ x: (sx - tx) / zoom, y: (sy - ty) / zoom }),
    [tx, ty, zoom],
  );
  const localPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);
  const eventDoc = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const p = localPoint(e);
      return toDoc(p.x, p.y);
    },
    [localPoint, toDoc],
  );

  // -------------------------------------------------------------------------
  // Sizing + fit
  // -------------------------------------------------------------------------

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    observer.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  // Hold space to pan, whatever tool is active.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      spaceHeld.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const fitToView = useCallback(() => {
    if (!size.w || !size.h) return;
    const next = Math.min((size.w - 80) / vw, (size.h - 80) / vh);
    useSvgStore.getState().setView(Math.max(0.02, Math.min(8, next)), 0, 0);
  }, [size.w, size.h, vw, vh]);

  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !size.w || !vw) return;
    fitted.current = true;
    fitToView();
  }, [size.w, vw, fitToView]);

  // -------------------------------------------------------------------------
  // Selection frames — read back from the live DOM after every commit
  // -------------------------------------------------------------------------

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const next: Record<string, Frame> = {};
    for (const id of selection) {
      const el = findElement(content, id);
      if (!el) continue;
      const frame = frameOf(content, el);
      if (frame) next[id] = frame;
    }
    if (hovered && !next[hovered]) {
      const el = findElement(content, hovered);
      if (el) {
        const frame = frameOf(content, el);
        if (frame) next[hovered] = frame;
      }
    }
    setFrames(next);
  }, [selection, hovered, nodes, order, zoom, panX, panY, size.w, size.h]);

  /** Ignore nodes whose ancestor is also selected — they'd be transformed twice. */
  const effectiveSelection = useMemo(() => {
    if (selection.length < 2) return selection;
    const parents = buildParentMap(nodes);
    return selection.filter((id) => {
      let p = parents[id];
      while (p) {
        if (selection.includes(p)) return false;
        p = parents[p];
      }
      return true;
    });
  }, [selection, nodes]);

  const activeFrame: Frame | null = useMemo(() => {
    if (effectiveSelection.length === 0) return null;
    if (effectiveSelection.length === 1) return frames[effectiveSelection[0]] ?? null;
    const rects = effectiveSelection.map((id) => frames[id]).filter(Boolean).map(frameBounds);
    const box = unionRects(rects);
    return box ? { box, matrix: new DOMMatrix() } : null;
  }, [effectiveSelection, frames]);

  // -------------------------------------------------------------------------
  // Node (path) editing
  // -------------------------------------------------------------------------

  const editData = useMemo(() => {
    if (tool !== 'node' || !editing) return null;
    const node = nodes[editing];
    if (!node) return null;
    const d = nodeToPathData(node);
    if (d === null) return null;
    const curves = toCurves(d);
    const content = contentRef.current;
    const el = content ? findElement(content, editing) : null;
    const frame = el && content ? frameOf(content, el) : null;
    return { curves, anchors: getAnchors(curves), matrix: frame?.matrix ?? new DOMMatrix(), node };
  }, [tool, editing, nodes]);

  /** Writes an edited curve list back into the node, converting primitives to
   *  `<path>` on first edit so shapes are editable too. */
  const commitCurves = useCallback((nodeId: string, curves: Curves) => {
    const store = useSvgStore.getState();
    const node = store.nodes[nodeId];
    if (!node) return;
    const d = curvesToPathString(curves);
    if (node.tag === 'path') {
      store.updateAttrs(nodeId, { d });
      return;
    }
    const attrs: Record<string, string> = { ...node.attrs, d };
    for (const key of ['x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'points']) {
      delete attrs[key];
    }
    store.updateNode(nodeId, { tag: 'path', attrs });
  }, []);

  // -------------------------------------------------------------------------
  // Snap candidates
  // -------------------------------------------------------------------------

  const snapCandidates = useCallback(
    (exclude: string[]): Rect[] => {
      const content = contentRef.current;
      if (!content || !snapToObjects) return [{ x: vx, y: vy, width: vw, height: vh }];
      const excluded = new Set(exclude.flatMap((id) => collectSubtree(id, nodes)));
      const rects: Rect[] = [{ x: vx, y: vy, width: vw, height: vh }];
      for (const id of order) {
        if (excluded.has(id)) continue;
        const el = findElement(content, id);
        if (!el) continue;
        const bounds = boundsOf(content, el);
        if (bounds) rects.push(bounds);
      }
      return rects;
    },
    [snapToObjects, nodes, order, vx, vy, vw, vh],
  );

  // -------------------------------------------------------------------------
  // Transform helpers
  // -------------------------------------------------------------------------

  const applyToSelection = useCallback(
    (startNodes: Record<string, SvgNode>, matrix: DOMMatrix) => {
      const content = contentRef.current;
      if (!content) return;
      const store = useSvgStore.getState();
      for (const [id, original] of Object.entries(startNodes)) {
        const transform = applyCanvasMatrix(content, original, matrix);
        store.updateAttrs(id, { transform: transform || null });
      }
    },
    [],
  );

  const captureNodes = useCallback((): Record<string, SvgNode> => {
    const store = useSvgStore.getState();
    const out: Record<string, SvgNode> = {};
    for (const id of effectiveSelection) {
      const node = store.nodes[id];
      if (node && !node.locked) out[id] = { ...node, attrs: { ...node.attrs } };
    }
    return out;
  }, [effectiveSelection]);

  // -------------------------------------------------------------------------
  // Pointer handling
  // -------------------------------------------------------------------------

  const finishPen = useCallback(
    (close: boolean) => {
      const anchors = penAnchors;
      setPenAnchors([]);
      setPenPreview(null);
      if (anchors.length < 2) return;
      const store = useSvgStore.getState();
      const d = penAnchorsToPath(anchors, close);
      const id = store.addNode(makePath(d, store.defaults, close));
      store.select([id]);
      store.setTool('select');
    },
    [penAnchors],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const store = useSvgStore.getState();
      const p = localPoint(e);
      const doc = toDoc(p.x, p.y);
      const target = e.target as SVGElement;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);

      // Panning: middle mouse, space-drag, or the hand tool.
      if (e.button === 1 || store.tool === 'pan' || (e.button === 0 && spaceHeld.current)) {
        dragRef.current = { kind: 'pan', startClient: p, startPan: { x: store.panX, y: store.panY } };
        return;
      }
      if (e.button !== 0) return;

      // An unlocked underlay is draggable; a locked one never sees the pointer.
      if (target.dataset?.underlay && store.underlay) {
        dragRef.current = {
          kind: 'underlay',
          start: doc,
          origin: { x: store.underlay.x, y: store.underlay.y },
        };
        return;
      }

      // --- Node tool -------------------------------------------------------
      if (store.tool === 'node') {
        const anchorAttr = target.dataset?.anchor;
        if (anchorAttr !== undefined && editData) {
          const index = Number(anchorAttr);
          const which = (target.dataset.handleKind as 'in' | 'out' | undefined) ?? 'point';
          if (e.altKey && which === 'point') {
            const anchors = editData.anchors;
            const isSmooth = anchors[index]?.inHandle && anchors[index]?.outHandle;
            store.pushHistory();
            commitCurves(editing!, isSmooth ? makeCorner(editData.curves, index) : makeSmooth(editData.curves, index));
            return;
          }
          store.setSelectedAnchors([index]);
          store.pushHistory();
          dragRef.current = {
            kind: 'anchor',
            anchor: index,
            which,
            startCurves: editData.curves,
            toLocal: DOMMatrix.fromMatrix(editData.matrix).invertSelf(),
            start: doc,
          };
          return;
        }

        // Click on the path body inserts an anchor.
        if (editData && target.dataset?.nid === editing) {
          const local = transformPoint(DOMMatrix.fromMatrix(editData.matrix).invertSelf(), doc.x, doc.y);
          const hit = nearestOnPath(editData.curves, local);
          if (hit && hit.distance * zoom < 8) {
            store.pushHistory();
            commitCurves(editing!, insertAnchorAt(editData.curves, hit.segIndex, hit.t));
            return;
          }
        }

        const nid = target.dataset?.nid;
        if (nid) {
          store.select([nid]);
          store.setEditing(nid);
        } else {
          store.setSelectedAnchors([]);
        }
        return;
      }

      // --- Drawing tools ---------------------------------------------------
      if (['rect', 'ellipse', 'line', 'polygon', 'star'].includes(store.tool)) {
        dragRef.current = { kind: 'draw', start: doc, current: doc };
        return;
      }
      if (store.tool === 'pencil') {
        dragRef.current = { kind: 'pencil', points: [[doc.x, doc.y, e.pressure || 0.5]] };
        return;
      }
      if (store.tool === 'text') {
        const id = store.addNode(makeText(doc.x, doc.y, 'Текст', store.defaults));
        store.select([id]);
        store.setTool('select');
        setTextEdit({ id, value: 'Текст' });
        return;
      }
      if (store.tool === 'pen') {
        // Clicking the first anchor closes the shape.
        if (penAnchors.length > 1) {
          const first = penAnchors[0].point;
          if (Math.hypot(first.x - doc.x, first.y - doc.y) * zoom < 8) {
            finishPen(true);
            return;
          }
        }
        setPenAnchors((prev) => [...prev, { point: doc, handle: null }]);
        return;
      }

      // --- Select tool -----------------------------------------------------
      const handle = target.dataset?.handle as HandleId | 'rotate' | undefined;
      if (handle && activeFrame) {
        store.pushHistory();
        const startNodes = captureNodes();
        if (handle === 'rotate') {
          const bounds = frameBounds(activeFrame);
          const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
          dragRef.current = {
            kind: 'rotate',
            center,
            startAngle: Math.atan2(doc.y - center.y, doc.x - center.x),
            startNodes,
          };
        } else {
          dragRef.current = { kind: 'resize', handle, frame: activeFrame, startNodes };
        }
        return;
      }

      const nid = target.dataset?.nid;
      if (nid) {
        // Clicking a child selects its outermost group, unless you dig in with
        // a modifier — the usual "enter the group" behaviour.
        const parents = buildParentMap(store.nodes);
        let pick = nid;
        if (!e.metaKey && !e.ctrlKey) {
          let p = parents[pick];
          while (p) { pick = p; p = parents[pick]; }
        }

        if (e.shiftKey) {
          store.toggleSelection(pick);
        } else if (!store.selection.includes(pick)) {
          store.select([pick]);
        }

        const selected = useSvgStore.getState().selection;
        if (selected.length > 0) {
          store.pushHistory();
          const startNodes: Record<string, SvgNode> = {};
          for (const id of selected) {
            const node = store.nodes[id];
            if (node && !node.locked) startNodes[id] = { ...node, attrs: { ...node.attrs } };
          }
          const content = contentRef.current;
          const rects = content
            ? Object.keys(startNodes)
                .map((id) => findElement(content, id))
                .filter((el): el is SVGGraphicsElement => Boolean(el))
                .map((el) => boundsOf(content, el))
                .filter((r): r is Rect => Boolean(r))
            : [];
          dragRef.current = {
            kind: 'move',
            start: doc,
            startNodes,
            startBounds: unionRects(rects) ?? { x: doc.x, y: doc.y, width: 0, height: 0 },
          };
        }
        return;
      }

      if (!e.shiftKey) store.clearSelection();
      dragRef.current = { kind: 'marquee', start: doc, current: doc, additive: e.shiftKey };
    },
    [localPoint, toDoc, editData, editing, commitCurves, zoom, penAnchors, finishPen, activeFrame, captureNodes],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const store = useSvgStore.getState();
      const p = localPoint(e);
      const doc = toDoc(p.x, p.y);
      const drag = dragRef.current;

      if (!drag) {
        if (store.tool === 'pen' && penAnchors.length > 0) setPenPreview(doc);
        if (store.tool === 'select') {
          const nid = (e.target as SVGElement).dataset?.nid;
          const parents = buildParentMap(store.nodes);
          let pick = nid ?? null;
          if (pick && !e.metaKey && !e.ctrlKey) {
            let parent = parents[pick];
            while (parent) { pick = parent; parent = parents[pick]; }
          }
          if (pick !== store.hovered) store.setHovered(pick);
        }
        return;
      }

      switch (drag.kind) {
        case 'pan':
          store.setView(
            store.zoom,
            drag.startPan.x + (p.x - drag.startClient.x),
            drag.startPan.y + (p.y - drag.startClient.y),
          );
          break;

        case 'marquee':
          drag.current = doc;
          setFrames((f) => ({ ...f })); // nudge a repaint of the marquee
          break;

        case 'move': {
          let dx = doc.x - drag.start.x;
          let dy = doc.y - drag.start.y;
          if (e.shiftKey) {
            // Constrain to the dominant axis.
            if (Math.abs(dx) > Math.abs(dy)) dy = 0;
            else dx = 0;
          }
          const moved = {
            x: drag.startBounds.x + dx,
            y: drag.startBounds.y + dy,
            width: drag.startBounds.width,
            height: drag.startBounds.height,
          };
          if (!e.altKey) {
            const snap = snapRect(
              moved,
              snapCandidates(Object.keys(drag.startNodes)),
              SNAP_PX / zoom,
              snapToGrid ? gridSize : null,
            );
            dx += snap.dx;
            dy += snap.dy;
            setGuides(snap.guides);
          } else {
            setGuides([]);
          }
          applyToSelection(drag.startNodes, translationMatrix(dx, dy));
          break;
        }

        case 'resize': {
          const inv = DOMMatrix.fromMatrix(drag.frame.matrix).invertSelf();
          const local = transformPoint(inv, doc.x, doc.y);
          const { box } = drag.frame;
          const uv = HANDLE_UV[drag.handle];
          const anchor = {
            x: box.x + box.width * (1 - uv[0]),
            y: box.y + box.height * (1 - uv[1]),
          };
          const handlePos = { x: box.x + box.width * uv[0], y: box.y + box.height * uv[1] };

          let sx = uv[0] === 0.5 ? 1 : (local.x - anchor.x) / (handlePos.x - anchor.x || 1e-6);
          let sy = uv[1] === 0.5 ? 1 : (local.y - anchor.y) / (handlePos.y - anchor.y || 1e-6);
          if (e.shiftKey && uv[0] !== 0.5 && uv[1] !== 0.5) {
            const k = Math.max(Math.abs(sx), Math.abs(sy));
            sx = Math.sign(sx) * k;
            sy = Math.sign(sy) * k;
          }
          if (!Number.isFinite(sx) || sx === 0) sx = 1e-4;
          if (!Number.isFinite(sy) || sy === 0) sy = 1e-4;

          // Scale in the frame's own axes, then move it back into canvas space.
          const localScale = scaleAboutMatrix(sx, sy, anchor.x, anchor.y);
          const matrix = DOMMatrix.fromMatrix(drag.frame.matrix)
            .multiply(localScale)
            .multiply(inv);
          applyToSelection(drag.startNodes, matrix);
          break;
        }

        case 'rotate': {
          const angle = Math.atan2(doc.y - drag.center.y, doc.x - drag.center.x);
          let deg = ((angle - drag.startAngle) * 180) / Math.PI;
          if (e.shiftKey) deg = Math.round(deg / 15) * 15;
          applyToSelection(drag.startNodes, rotateAboutMatrix(deg, drag.center.x, drag.center.y));
          break;
        }

        case 'anchor': {
          if (!editing) break;
          const local = transformPoint(drag.toLocal, doc.x, doc.y);
          const startLocal = transformPoint(drag.toLocal, drag.start.x, drag.start.y);
          const next =
            drag.which === 'point'
              ? moveAnchor(drag.startCurves, drag.anchor, local.x - startLocal.x, local.y - startLocal.y)
              : moveHandle(drag.startCurves, drag.anchor, drag.which, local.x, local.y, !e.altKey);
          commitCurves(editing, next);
          break;
        }

        case 'draw':
          drag.current = doc;
          setFrames((f) => ({ ...f }));
          break;

        case 'pencil':
          drag.points.push([doc.x, doc.y, e.pressure || 0.5]);
          setFrames((f) => ({ ...f }));
          break;

        case 'underlay': {
          let dx = doc.x - drag.start.x;
          let dy = doc.y - drag.start.y;
          if (e.shiftKey) {
            if (Math.abs(dx) > Math.abs(dy)) dy = 0;
            else dx = 0;
          }
          store.updateUnderlay({ x: drag.origin.x + dx, y: drag.origin.y + dy });
          break;
        }
      }
    },
    [
      localPoint, toDoc, penAnchors.length, snapCandidates, zoom, snapToGrid, gridSize,
      applyToSelection, editing, commitCurves,
    ],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      setGuides([]);
      if (!drag) return;
      const store = useSvgStore.getState();

      if (drag.kind === 'marquee') {
        const rect = normalizeRect(drag.start.x, drag.start.y, drag.current.x, drag.current.y);
        if (rect.width < 1 && rect.height < 1) return;
        const content = contentRef.current;
        if (!content) return;
        const hits: string[] = [];
        for (const id of store.order) {
          const el = findElement(content, id);
          if (!el || store.nodes[id]?.locked) continue;
          const bounds = boundsOf(content, el);
          if (bounds && rectsIntersect(rect, bounds)) hits.push(id);
        }
        if (drag.additive) store.addToSelection(hits);
        else store.select(hits);
        return;
      }

      if (drag.kind === 'draw') {
        const rect = normalizeRect(drag.start.x, drag.start.y, drag.current.x, drag.current.y);
        const shift = e.shiftKey;
        if (shift) {
          const s = Math.max(rect.width, rect.height);
          rect.width = s;
          rect.height = s;
        }
        if (rect.width < 1 && rect.height < 1) return;
        const d = store.defaults;
        let node: Omit<SvgNode, 'id'> | null = null;
        if (store.tool === 'rect') node = makeRect(rect.x, rect.y, rect.width, rect.height, d);
        else if (store.tool === 'ellipse') node = makeEllipse(rect.x, rect.y, rect.width, rect.height, d);
        else if (store.tool === 'line') node = makeLine(drag.start.x, drag.start.y, drag.current.x, drag.current.y, d);
        else if (store.tool === 'polygon') node = makePolygon(rect.x, rect.y, rect.width, rect.height, d);
        else if (store.tool === 'star') node = makeStar(rect.x, rect.y, rect.width, rect.height, d);
        if (node) {
          const id = store.addNode(node);
          store.select([id]);
          store.setTool('select');
        }
        return;
      }

      if (drag.kind === 'pencil') {
        const node = makeFreehand(drag.points, store.defaults.fill, {
          ...DEFAULT_FREEHAND,
          // Keep the visual stroke width constant regardless of zoom level.
          size: store.defaults.strokeWidth * 2.5,
        });
        if (node) {
          const id = store.addNode(node);
          store.select([id]);
        }
        return;
      }
    },
    [],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const store = useSvgStore.getState();
      const p = localPoint(e);
      if (e.ctrlKey || e.metaKey) {
        const before = toDoc(p.x, p.y);
        const next = Math.min(64, Math.max(0.02, store.zoom * Math.exp(-e.deltaY * 0.01)));
        store.setView(
          next,
          p.x - size.w / 2 - (before.x - (vx + vw / 2)) * next,
          p.y - size.h / 2 - (before.y - (vy + vh / 2)) * next,
        );
      } else {
        store.setView(store.zoom, store.panX - e.deltaX, store.panY - e.deltaY);
      }
    },
    [localPoint, toDoc, size.w, size.h, vx, vy, vw, vh],
  );

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const store = useSvgStore.getState();
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo(); else store.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); store.selectAll(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); store.duplicateNodes(store.selection); return; }
      if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) store.ungroup(store.selection);
        else store.group(store.selection);
        return;
      }
      if (mod && e.key === ']') { e.preventDefault(); store.reorder(store.selection, e.shiftKey ? 'front' : 'forward'); return; }
      if (mod && e.key === '[') { e.preventDefault(); store.reorder(store.selection, e.shiftKey ? 'back' : 'backward'); return; }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (store.tool === 'node' && store.editing && store.selectedAnchors.length > 0) {
          const node = store.nodes[store.editing];
          const d = node ? nodeToPathData(node) : null;
          if (d !== null) {
            let curves = toCurves(d);
            store.pushHistory();
            for (const index of [...store.selectedAnchors].sort((a, b) => b - a)) {
              curves = deleteAnchorSafe(curves, index);
            }
            commitCurves(store.editing, curves);
            store.setSelectedAnchors([]);
          }
          return;
        }
        store.deleteNodes(store.selection);
        return;
      }

      if (e.key === 'Escape') {
        if (penAnchors.length) { finishPen(false); return; }
        store.clearSelection();
        store.setTool('select');
        return;
      }
      if (e.key === 'Enter' && penAnchors.length) { finishPen(false); return; }
      if (e.key === '0') { e.preventDefault(); fitToView(); return; }
      if (e.key === '1') { e.preventDefault(); store.setView(1, 0, 0); return; }

      if (e.key.startsWith('Arrow') && store.selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        store.pushHistory();
        const content = contentRef.current;
        if (!content) return;
        for (const id of store.selection) {
          const node = store.nodes[id];
          if (!node || node.locked) continue;
          const transform = applyCanvasMatrix(content, node, translationMatrix(dx, dy));
          store.updateAttrs(id, { transform: transform || null });
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [penAnchors.length, finishPen, fitToView, commitCurves]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const drag = dragRef.current;
  const interactive = tool === 'select' || tool === 'node';

  const penScreenAnchors = penAnchors.map((a) => ({
    point: toScreen(a.point.x, a.point.y),
    handle: a.handle ? toScreen(a.handle.x, a.handle.y) : null,
  }));
  const penPath = penAnchors.length
    ? penAnchorsToPath(penScreenAnchors, false, penPreview ? toScreen(penPreview.x, penPreview.y) : undefined)
    : '';

  const artboard = {
    x: toScreen(vx, vy).x,
    y: toScreen(vx, vy).y,
    w: vw * zoom,
    h: vh * zoom,
  };

  return (
    <div
      ref={hostRef}
      className="relative w-full h-full overflow-hidden bg-[#101116]"
      style={{ cursor: cursorForTool(tool) }}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg
        ref={rootRef}
        width={size.w}
        height={size.h}
        className="absolute inset-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => useSvgStore.getState().setHovered(null)}
        onContextMenu={(e) => {
          const store = useSvgStore.getState();
          const target = e.target as SVGElement;
          const nid = target.dataset?.nid;

          if (nid) {
            // Right-clicking outside the selection retargets it first, so the
            // menu always acts on what the user just pointed at.
            const parents = buildParentMap(store.nodes);
            let pick = nid;
            if (!e.metaKey && !e.ctrlKey) {
              let p = parents[pick];
              while (p) { pick = p; p = parents[pick]; }
            }
            const ids = store.selection.includes(pick) ? store.selection : [pick];
            if (!store.selection.includes(pick)) store.select([pick]);
            menu.open(e, nodeMenuItems(ids));
            return;
          }

          menu.open(e, [
            { label: 'Выделить всё', shortcut: '⌘A', onSelect: () => store.selectAll() },
            { label: 'Снять выделение', disabled: store.selection.length === 0, onSelect: () => store.clearSelection() },
            {},
            { label: 'Вписать в окно', shortcut: '0', onSelect: fitToView },
            { label: 'Масштаб 100 %', shortcut: '1', onSelect: () => store.setView(1, 0, 0) },
            ...(store.underlay
              ? [
                  {} as never,
                  {
                    label: store.underlay.visible ? 'Скрыть подложку' : 'Показать подложку',
                    onSelect: () => store.updateUnderlay({ visible: !store.underlay!.visible }),
                  },
                  {
                    label: store.underlay.locked ? 'Разблокировать подложку' : 'Заблокировать подложку',
                    onSelect: () => store.updateUnderlay({ locked: !store.underlay!.locked }),
                  },
                ]
              : []),
          ]);
        }}
        onDoubleClick={(e) => {
          const nid = (e.target as SVGElement).dataset?.nid;
          const store = useSvgStore.getState();
          if (!nid) return;
          const node = store.nodes[nid];
          if (node?.tag === 'text') {
            setTextEdit({ id: nid, value: stripTags(node.text ?? '') });
            store.select([nid]);
            return;
          }
          // Drill into a group, or jump straight to node editing on a shape.
          store.select([nid]);
          if (node && node.tag !== 'g') store.setTool('node');
        }}
      >
        <defs>
          <pattern id="inj-checker" width={16} height={16} patternUnits="userSpaceOnUse">
            <rect width={16} height={16} fill="#202128" />
            <rect width={8} height={8} fill="#2a2b33" />
            <rect x={8} y={8} width={8} height={8} fill="#2a2b33" />
          </pattern>
          <pattern
            id="inj-grid"
            width={gridSize * zoom}
            height={gridSize * zoom}
            patternUnits="userSpaceOnUse"
            x={artboard.x}
            y={artboard.y}
          >
            <path
              d={`M ${gridSize * zoom} 0 L 0 0 0 ${gridSize * zoom}`}
              fill="none"
              stroke="#ffffff"
              strokeOpacity={0.07}
              strokeWidth={1}
            />
          </pattern>
        </defs>

        {/* Artboard */}
        <rect
          x={artboard.x} y={artboard.y} width={artboard.w} height={artboard.h}
          fill={transparentBg ? 'url(#inj-checker)' : '#ffffff'}
          stroke="#3a3c48" strokeWidth={1}
        />

        {/* Document content, in doc units */}
        <g transform={`translate(${tx} ${ty}) scale(${zoom})`}>
          {underlay && underlayUrl && underlay.visible && (
            <image
              href={underlayUrl}
              x={underlay.x}
              y={underlay.y}
              width={underlay.width}
              height={underlay.height}
              opacity={underlay.opacity}
              preserveAspectRatio="none"
              data-underlay="1"
              pointerEvents={underlay.locked ? 'none' : 'all'}
              style={{ cursor: underlay.locked ? 'default' : 'move' }}
            />
          )}
          <g ref={contentRef} id={CONTENT_GROUP_ID}>
            <Scene order={order} nodes={nodes} defs={defs} interactive={interactive} />
          </g>
        </g>

        {showGrid && (
          <rect
            x={artboard.x} y={artboard.y} width={artboard.w} height={artboard.h}
            fill="url(#inj-grid)" pointerEvents="none"
          />
        )}

        {/* Overlays live in screen pixels so handles keep a constant size */}
        <g pointerEvents="none">
          {hovered && !selection.includes(hovered) && frames[hovered] && (
            <HoverOutline frame={frames[hovered]} toScreen={toScreen} />
          )}
        </g>

        <g>
          {activeFrame && tool !== 'node' && (
            <SelectionOverlay frame={activeFrame} toScreen={toScreen} showHandles={tool === 'select'} />
          )}
          {tool === 'node' && editData && (
            <NodeOverlay
              anchors={editData.anchors}
              matrix={editData.matrix}
              toScreen={toScreen}
              selected={selectedAnchors.length ? selectedAnchors : editData.anchors.map((_: Anchor, i: number) => i)}
            />
          )}
        </g>

        <Guides guides={guides} toScreen={toScreen} size={size} />

        {drag?.kind === 'marquee' && (
          <MarqueeBox
            rect={normalizeRect(drag.start.x, drag.start.y, drag.current.x, drag.current.y)}
            toScreen={toScreen}
          />
        )}

        {drag?.kind === 'draw' && (
          <DrawPreview tool={tool} start={drag.start} current={drag.current} toScreen={toScreen} />
        )}

        {drag?.kind === 'pencil' && (
          <polyline
            points={drag.points.map(([x, y]) => { const p = toScreen(x, y); return `${p.x},${p.y}`; }).join(' ')}
            fill="none" stroke="#00d6a4" strokeWidth={1.5} pointerEvents="none"
          />
        )}

        {penPath && <PenPreview d={penPath} anchors={penScreenAnchors} toScreen={(x, y) => ({ x, y })} />}
      </svg>

      {textEdit && (
        <TextEditor
          edit={textEdit}
          toScreen={toScreen}
          zoom={zoom}
          onDone={() => setTextEdit(null)}
        />
      )}

      <ZoomBadge zoom={zoom} onFit={fitToView} />
      {menu.anchor && <ContextMenu anchor={menu.anchor} onClose={menu.close} />}
    </div>
  );
}

const HANDLE_UV: Record<HandleId, [number, number]> = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5],
  se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
};

/** Keeps a path usable: never delete below two anchors. */
function deleteAnchorSafe(curves: Curves, index: number): Curves {
  const anchors = getAnchors(curves);
  if (anchors.length <= 2) return curves;
  const next = curves.map((s) => [...s] as Curves[number]);
  const anchor = anchors[index];
  if (!anchor) return curves;
  if (next[anchor.index][0] === 'M') return curves;
  const removed = next[anchor.index];
  const following = next[anchor.index + 1];
  if (following && following[0] === 'C') {
    following[1] = removed[1];
    following[2] = removed[2];
  }
  next.splice(anchor.index, 1);
  return next;
}

function DrawPreview({
  tool, start, current, toScreen,
}: { tool: string; start: Point; current: Point; toScreen: (x: number, y: number) => Point }) {
  const a = toScreen(start.x, start.y);
  const b = toScreen(current.x, current.y);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  const stroke = { stroke: '#00d6a4', strokeWidth: 1, fill: 'rgba(0,214,164,0.08)', pointerEvents: 'none' as const };

  if (tool === 'line') return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#00d6a4" strokeWidth={1.5} pointerEvents="none" />;
  if (tool === 'ellipse') return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...stroke} />;
  return <rect x={x} y={y} width={w} height={h} {...stroke} />;
}

function TextEditor({
  edit, toScreen, zoom, onDone,
}: {
  edit: { id: string; value: string };
  toScreen: (x: number, y: number) => Point;
  zoom: number;
  onDone: () => void;
}) {
  const node = useSvgStore((s) => s.nodes[edit.id]);
  const [value, setValue] = useState(edit.value);
  if (!node) return null;

  const x = Number(node.attrs.x ?? 0);
  const y = Number(node.attrs.y ?? 0);
  const fontSize = Number(node.attrs['font-size'] ?? 16);
  const p = toScreen(x, y);

  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const store = useSvgStore.getState();
        store.pushHistory();
        store.updateNode(edit.id, { text: escapeText(value), name: value.slice(0, 24) || 'Текст' });
        onDone();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') onDone();
      }}
      className="absolute bg-panel-2 border border-accent rounded px-1 outline-none text-white"
      style={{
        left: p.x,
        top: p.y - fontSize * zoom,
        fontSize: Math.max(11, fontSize * zoom),
        minWidth: 80,
      }}
    />
  );
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stripTags(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent ?? '';
}

function cursorForTool(tool: string): string {
  if (tool === 'pan') return 'grab';
  if (tool === 'select' || tool === 'node') return 'default';
  if (tool === 'text') return 'text';
  return 'crosshair';
}

function ZoomBadge({ zoom, onFit }: { zoom: number; onFit: () => void }) {
  return (
    <div className="absolute bottom-3 left-3 flex items-center gap-1 bg-panel-2/90 border border-border rounded-md px-1.5 py-1 backdrop-blur">
      <button
        onClick={() => useSvgStore.getState().setZoom(zoom / 1.25)}
        className="w-5 h-5 rounded text-gray-400 hover:text-white hover:bg-panel-3 text-xs leading-none"
      >
        −
      </button>
      <button
        onClick={onFit}
        className="text-[10px] font-mono text-gray-300 w-12 text-center hover:text-white"
        title="Вписать (0)"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        onClick={() => useSvgStore.getState().setZoom(zoom * 1.25)}
        className="w-5 h-5 rounded text-gray-400 hover:text-white hover:bg-panel-3 text-xs leading-none"
      >
        +
      </button>
    </div>
  );
}
