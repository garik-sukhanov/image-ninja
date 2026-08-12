/** Inline 16×16 stroke icons — no icon-font dependency, no network fetch. */

const P = {
  cursor: 'M4 2.5 13 9l-4.2.8L11 14l-1.8.8-2.2-4.3L4 13.5z',
  hand: 'M6 8V4.2a1.2 1.2 0 0 1 2.4 0V8m0-.8V3.4a1.2 1.2 0 0 1 2.4 0V8m0-.5V4.6a1.2 1.2 0 0 1 2.4 0v5.2c0 2.6-1.7 4.2-4.2 4.2S4.4 12.4 3.8 10L3 8.3a1.2 1.2 0 0 1 2-1.2l1 1.4',
  crop: 'M4.5 1.5v10h10M1.5 4.5h10v10',
  wand: 'M11 2.2 12 3.2M13.5 4.7 14.5 5.7M11.8 5.5 12.8 4.5M2 14l7.5-7.5M9.5 6.5l-1.6-1.6a.7.7 0 0 0-1 0L2 9.8a.7.7 0 0 0 0 1L3.6 12.4',
  eraser: 'M6.5 13.5H14M3 10.5l3.5 3.5 7-7L10 3.5z',
  brush: 'M9.5 3.5 12.5 6.5M4 12.5c1.5 0 2-1 2-2 0-.8-.6-1.5-1.5-1.5S3 9.7 3 10.5c0 1.5-1 2-1 2 .8.5 1.4.5 2 0zM6 9 12 3a1.4 1.4 0 0 1 2 2L8 11',
  picker: 'M13.8 2.2a1.7 1.7 0 0 0-2.4 0L9.8 3.8 9 3 7.6 4.4l4 4L13 7l-.8-.8 1.6-1.6a1.7 1.7 0 0 0 0-2.4zM9.6 6.4 3.4 12.6 3 14l1.4-.4 6.2-6.2z',
  rotateLeft: 'M2.5 6.5h4v-4M2.8 6.4A5.5 5.5 0 1 1 2.6 9.4',
  rotateRight: 'M13.5 6.5h-4v-4M13.2 6.4A5.5 5.5 0 1 0 13.4 9.4',
  flipH: 'M8 2v12M6 5 2.5 8 6 11zM10 5l3.5 3-3.5 3z',
  flipV: 'M2 8h12M5 6 8 2.5 11 6zM5 10l3 3.5 3-3.5z',
  undo: 'M3 7h7a3.5 3.5 0 0 1 0 7H6M3 7l3-3M3 7l3 3',
  redo: 'M13 7H6a3.5 3.5 0 0 0 0 7h4M13 7l-3-3M13 7l-3 3',
  sparkles: 'M8 2l1.3 3.4L12.7 6.7 9.3 8 8 11.4 6.7 8 3.3 6.7 6.7 5.4zM12.5 10.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z',
  trash: 'M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v5M9.5 6.5v5',
  invert: 'M8 1.5a6.5 6.5 0 1 0 0 13zM8 1.5a6.5 6.5 0 1 1 0 13',
  node: 'M3 13 6 6l4 3 3-7M3 13h.01M13 2h.01M6 6h.01M10 9h.01',
  pen: 'M8 1.5 11 8l-3 6.5L5 8zM5 8h6',
  pencil: 'M11.5 2.5 13.5 4.5 5 13 2 14 3 11zM10 4l2 2',
  rect: 'M2.5 3.5h11v9h-11z',
  ellipse: 'M8 3.5c3 0 5.5 2 5.5 4.5S11 12.5 8 12.5 2.5 10.5 2.5 8 5 3.5 8 3.5z',
  line: 'M3 13 13 3',
  polygon: 'M8 2.2 13.5 6.2 11.4 12.7H4.6L2.5 6.2z',
  star: 'M8 1.8l1.9 4.1 4.4.5-3.3 3 .9 4.4L8 11.6l-3.9 2.2.9-4.4-3.3-3 4.4-.5z',
  text: 'M3 3h10M8 3v10M6 13h4',
  group: 'M2 2h4v4H2zM10 2h4v4h-4zM2 10h4v4H2zM10 10h4v4h-4z',
  ungroup: 'M2 2h5v5H2zM9 9h5v5H9zM9 4h5M11.5 2v4M2 11.5h5M4.5 9v5',
  toFront: 'M4 4h8v8H4zM2 2h8M2 2v8',
  toBack: 'M4 4h8v8H4zM14 14H6M14 14V6',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  eyeOff: 'M2 2l12 12M6.5 6.6A2 2 0 0 0 9.4 9.4M4.2 4.6C2.5 5.9 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.2 0 2.2-.4 3.1-.9M13 10.4c.9-1.1 1.5-2.4 1.5-2.4S12 3.5 8 3.5c-.5 0-1 .1-1.4.2',
  lock: 'M4.5 7V5a3.5 3.5 0 1 1 7 0v2M3.5 7h9v6.5h-9z',
  unlock: 'M4.5 7V5a3.5 3.5 0 0 1 6.8-1.2M3.5 7h9v6.5h-9z',
  plus: 'M8 3v10M3 8h10',
  minus: 'M3 8h10',
  close: 'M4 4l8 8M12 4l-8 8',
  check: 'M3 8.5 6.5 12 13 4.5',
  download: 'M8 2v8M4.5 7 8 10.5 11.5 7M2.5 13h11',
  folder: 'M1.5 3.5h4.5l1.5 2h7v8h-13z',
  image: 'M2 2.5h12v11H2zM2 10.5l3.5-3 3 2.5 2.5-2 3 2.5M5.5 6.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  code: 'M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4',
  layers: 'M8 2 1.5 5.5 8 9l6.5-3.5zM1.5 10.5 8 14l6.5-3.5M1.5 8 8 11.5 14.5 8',
  alignLeft: 'M2 1.5v13M4 4.5h9M4 11.5h5',
  alignCenterX: 'M8 1.5v13M4 4.5h8M5.5 11.5h5',
  alignRight: 'M14 1.5v13M3 4.5h9M7 11.5h5',
  alignTop: 'M1.5 2h13M4.5 4v9M11.5 4v5',
  alignCenterY: 'M1.5 8h13M4.5 4v8M11.5 5.5v5',
  alignBottom: 'M1.5 14h13M4.5 3v9M11.5 7v5',
  distributeX: 'M2 2v12M14 2v12M7 4.5h2v7H7z',
  distributeY: 'M2 2h12M2 14h12M4.5 7v2h7V7z',
  grid: 'M1.5 5.5h13M1.5 10.5h13M5.5 1.5v13M10.5 1.5v13',
  magnet: 'M4 2v6a4 4 0 0 0 8 0V2h-3v6a1 1 0 0 1-2 0V2z',
  boolUnion: 'M2.5 2.5h8v3h3v8h-8v-3h-3z',
  boolSubtract: 'M2.5 2.5h8v8h-8zM10.5 5.5h3v8h-8v-3',
  boolIntersect: 'M5.5 5.5h5v5h-5zM2.5 2.5h8v3M13.5 13.5h-8v-3',
  boolExclude: 'M2.5 2.5h8v8h-8zM5.5 5.5h8v8h-8z',
  fit: 'M2 5.5v-3.5h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5',
  reset: 'M13.5 8a5.5 5.5 0 1 1-1.7-4M13.5 2v4h-4',
};

export type IconName = keyof typeof P;

export function Icon({
  name,
  size = 16,
  className = '',
  filled = false,
}: {
  name: IconName;
  size?: number;
  className?: string;
  filled?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={P[name]} />
    </svg>
  );
}
