import type { Frame, Point, Rect } from '../../svg/geometry';
import { frameCorners } from '../../svg/geometry';
import type { Guide } from '../../svg/snap';

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type HandleId = (typeof HANDLES)[number];

/** Local-space position of each handle, as a fraction of the frame box. */
const HANDLE_UV: Record<HandleId, [number, number]> = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5],
  se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
};

export function handlePoints(frame: Frame): Record<HandleId, Point> {
  const { box, matrix } = frame;
  const out = {} as Record<HandleId, Point>;
  for (const id of HANDLES) {
    const [u, v] = HANDLE_UV[id];
    const x = box.x + box.width * u;
    const y = box.y + box.height * v;
    out[id] = { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f };
  }
  return out;
}

export function SelectionOverlay({
  frame,
  toScreen,
  showHandles,
}: {
  frame: Frame;
  toScreen: (x: number, y: number) => Point;
  showHandles: boolean;
}) {
  const corners = frameCorners(frame).map((p) => toScreen(p.x, p.y));
  const points = corners.map((p) => `${p.x},${p.y}`).join(' ');
  const handles = handlePoints(frame);

  // Rotation grip sits just outside the top edge, along its normal.
  const topMid = toScreen(
    (frame.box.x + frame.box.width / 2) * frame.matrix.a + (frame.box.y) * frame.matrix.c + frame.matrix.e,
    (frame.box.x + frame.box.width / 2) * frame.matrix.b + (frame.box.y) * frame.matrix.d + frame.matrix.f,
  );
  const center = {
    x: (corners[0].x + corners[2].x) / 2,
    y: (corners[0].y + corners[2].y) / 2,
  };
  const len = Math.hypot(topMid.x - center.x, topMid.y - center.y) || 1;
  const grip = {
    x: topMid.x + ((topMid.x - center.x) / len) * 22,
    y: topMid.y + ((topMid.y - center.y) / len) * 22,
  };

  return (
    <g>
      <polygon points={points} fill="none" stroke="#00d6a4" strokeWidth={1.25} />
      {showHandles && (
        <>
          <line
            x1={topMid.x} y1={topMid.y} x2={grip.x} y2={grip.y}
            stroke="#00d6a4" strokeWidth={1}
          />
          <circle
            cx={grip.x} cy={grip.y} r={5}
            fill="#16171c" stroke="#00d6a4" strokeWidth={1.25}
            data-handle="rotate" style={{ cursor: 'grab' }}
          />
          {HANDLES.map((id) => {
            const p = toScreen(handles[id].x, handles[id].y);
            return (
              <rect
                key={id}
                x={p.x - 4} y={p.y - 4} width={8} height={8}
                fill="#16171c" stroke="#00d6a4" strokeWidth={1.25}
                data-handle={id}
                style={{ cursor: cursorFor(id) }}
              />
            );
          })}
        </>
      )}
    </g>
  );
}

function cursorFor(id: HandleId): string {
  switch (id) {
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
    case 'nw': case 'se': return 'nwse-resize';
    default: return 'nesw-resize';
  }
}

export function HoverOutline({ frame, toScreen }: { frame: Frame; toScreen: (x: number, y: number) => Point }) {
  const points = frameCorners(frame)
    .map((p) => toScreen(p.x, p.y))
    .map((p) => `${p.x},${p.y}`)
    .join(' ');
  return <polygon points={points} fill="none" stroke="#00d6a4" strokeWidth={1} strokeOpacity={0.5} />;
}

export function MarqueeBox({ rect, toScreen }: { rect: Rect; toScreen: (x: number, y: number) => Point }) {
  const a = toScreen(rect.x, rect.y);
  const b = toScreen(rect.x + rect.width, rect.y + rect.height);
  return (
    <rect
      x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)}
      width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)}
      fill="#00d6a4" fillOpacity={0.08} stroke="#00d6a4" strokeWidth={1} strokeDasharray="3 3"
    />
  );
}

export function Guides({ guides, toScreen, size }: {
  guides: Guide[];
  toScreen: (x: number, y: number) => Point;
  size: { w: number; h: number };
}) {
  return (
    <g pointerEvents="none">
      {guides.map((g, i) => {
        if (g.orientation === 'v') {
          const p = toScreen(g.position, g.from);
          const q = toScreen(g.position, g.to);
          return (
            <line key={i} x1={p.x} y1={Math.max(0, p.y - 20)} x2={q.x} y2={Math.min(size.h, q.y + 20)}
              stroke="#ff7a45" strokeWidth={1} strokeDasharray="4 3" />
          );
        }
        const p = toScreen(g.from, g.position);
        const q = toScreen(g.to, g.position);
        return (
          <line key={i} x1={Math.max(0, p.x - 20)} y1={p.y} x2={Math.min(size.w, q.x + 20)} y2={q.y}
            stroke="#ff7a45" strokeWidth={1} strokeDasharray="4 3" />
        );
      })}
    </g>
  );
}
