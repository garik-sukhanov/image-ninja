import type { Anchor } from '../../svg/path';
import { transformPoint, type Point } from '../../svg/geometry';

/** Anchors and bezier handles for the path currently under the node tool. */
export function NodeOverlay({
  anchors,
  matrix,
  toScreen,
  selected,
}: {
  anchors: Anchor[];
  /** Local (path) space → canvas space. */
  matrix: DOMMatrix;
  toScreen: (x: number, y: number) => Point;
  selected: number[];
}) {
  const project = (p: Point) => {
    const c = transformPoint(matrix, p.x, p.y);
    return toScreen(c.x, c.y);
  };

  return (
    <g>
      {anchors.map((anchor, i) => {
        if (anchor.closing) return null;
        const a = project(anchor.point);
        const isSelected = selected.includes(i);
        return (
          <g key={i}>
            {isSelected && anchor.inHandle && !samePoint(anchor.inHandle, anchor.point) && (
              <Handle from={a} to={project(anchor.inHandle)} index={i} which="in" />
            )}
            {isSelected && anchor.outHandle && !samePoint(anchor.outHandle, anchor.point) && (
              <Handle from={a} to={project(anchor.outHandle)} index={i} which="out" />
            )}
            <rect
              x={a.x - 4}
              y={a.y - 4}
              width={8}
              height={8}
              rx={1}
              fill={isSelected ? '#00d6a4' : '#16171c'}
              stroke="#00d6a4"
              strokeWidth={1.25}
              data-anchor={i}
              style={{ cursor: 'pointer' }}
            />
          </g>
        );
      })}
    </g>
  );
}

function Handle({
  from, to, index, which,
}: { from: Point; to: Point; index: number; which: 'in' | 'out' }) {
  return (
    <g>
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#00d6a4" strokeWidth={1} strokeOpacity={0.6} />
      <circle
        cx={to.x}
        cy={to.y}
        r={4}
        fill="#16171c"
        stroke="#00d6a4"
        strokeWidth={1.25}
        data-anchor={index}
        data-handle-kind={which}
        style={{ cursor: 'pointer' }}
      />
    </g>
  );
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}

/** Live preview of the pen tool's in-progress path. */
export function PenPreview({
  d,
  anchors,
  toScreen,
}: {
  d: string;
  anchors: { point: Point; handle: Point | null }[];
  toScreen: (x: number, y: number) => Point;
}) {
  return (
    <g pointerEvents="none">
      <path d={d} fill="none" stroke="#00d6a4" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
      {anchors.map((a, i) => {
        const p = toScreen(a.point.x, a.point.y);
        return (
          <rect
            key={i}
            x={p.x - 3.5} y={p.y - 3.5} width={7} height={7}
            fill={i === 0 ? '#00d6a4' : '#16171c'} stroke="#00d6a4" strokeWidth={1.25}
          />
        );
      })}
    </g>
  );
}
