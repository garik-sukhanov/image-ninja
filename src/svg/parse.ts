import type { SvgCanvas, SvgNode } from '../types';

export interface ParsedSvg {
  canvas: SvgCanvas;
  rootAttrs: Record<string, string>;
  /** Raw markup of everything we deliberately don't model: defs, style, … */
  defs: string;
  order: string[];
  nodes: Record<string, SvgNode>;
}

/** Elements we walk into. Everything else keeps its inner markup verbatim. */
const CONTAINERS = new Set(['g', 'a', 'switch']);

/** Elements that live at the top of the file but aren't drawable content. */
const NON_VISUAL = new Set(['defs', 'style', 'title', 'desc', 'metadata', 'script']);

let idCounter = 0;
export function nextNodeId(): string {
  idCounter += 1;
  return `n${idCounter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function readAttrs(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
  return attrs;
}

/** "24", "24px", "50%" → number | null */
function parseLength(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^\s*(-?[\d.]+)\s*(px|pt|mm|cm|in|em|rem)?\s*$/.exec(value);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2];
  // Physical units are rare in the wild; convert the common ones at 96 dpi.
  const factor =
    unit === 'pt' ? 96 / 72 :
    unit === 'mm' ? 96 / 25.4 :
    unit === 'cm' ? 96 / 2.54 :
    unit === 'in' ? 96 :
    1;
  return n * factor;
}

function parseViewBox(value: string | null): [number, number, number, number] | null {
  if (!value) return null;
  const parts = value.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0], parts[1], parts[2], parts[3]];
}

/** Last resort: mount the SVG off-screen and ask the browser for its bounds. */
function measureBBox(svgEl: SVGSVGElement): [number, number, number, number] {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:-10000px;opacity:0;pointer-events:none';
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  holder.appendChild(clone);
  document.body.appendChild(holder);
  try {
    const box = clone.getBBox();
    if (box.width > 0 && box.height > 0) {
      return [box.x, box.y, box.width, box.height];
    }
  } catch {
    /* getBBox throws on empty documents */
  } finally {
    document.body.removeChild(holder);
  }
  return [0, 0, 512, 512];
}

function walk(
  el: Element,
  nodes: Record<string, SvgNode>,
): string {
  const tag = el.tagName.toLowerCase();
  const id = nextNodeId();
  const node: SvgNode = { id, tag, attrs: readAttrs(el) };

  if (CONTAINERS.has(tag)) {
    const children: string[] = [];
    for (const child of Array.from(el.children)) {
      if (NON_VISUAL.has(child.tagName.toLowerCase())) continue;
      children.push(walk(child, nodes));
    }
    node.children = children;
  } else if (el.innerHTML.trim()) {
    // <text> and friends: keep their markup exactly as authored.
    node.text = el.innerHTML;
  }

  const label = node.attrs['data-name'] ?? node.attrs['inkscape:label'];
  if (label) node.name = label;

  nodes[id] = node;
  return id;
}

export function parseSvg(source: string): ParsedSvg {
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('Не удалось разобрать SVG: файл повреждён');

  const svgEl = doc.documentElement as unknown as SVGSVGElement;
  if (svgEl.tagName.toLowerCase() !== 'svg') throw new Error('Это не SVG-файл');

  const rootAttrs = readAttrs(svgEl);
  const viewBoxAttr = parseViewBox(rootAttrs['viewBox'] ?? null);
  const widthAttr = parseLength(rootAttrs['width']);
  const heightAttr = parseLength(rootAttrs['height']);

  let viewBox: [number, number, number, number];
  if (viewBoxAttr) {
    viewBox = viewBoxAttr;
  } else if (widthAttr && heightAttr) {
    viewBox = [0, 0, widthAttr, heightAttr];
  } else {
    viewBox = measureBBox(svgEl);
  }

  const width = widthAttr ?? viewBox[2];
  const height = heightAttr ?? viewBox[3];

  // Everything non-drawable is preserved as raw markup so gradients, filters,
  // clip paths, embedded fonts and CSS keep working after a round trip.
  const defsParts: string[] = [];
  for (const child of Array.from(svgEl.children)) {
    if (NON_VISUAL.has(child.tagName.toLowerCase())) defsParts.push(child.outerHTML);
  }

  const nodes: Record<string, SvgNode> = {};
  const order: string[] = [];
  for (const child of Array.from(svgEl.children)) {
    if (NON_VISUAL.has(child.tagName.toLowerCase())) continue;
    order.push(walk(child, nodes));
  }

  // width/height/viewBox are modelled explicitly; don't duplicate them.
  const cleanRoot = { ...rootAttrs };
  delete cleanRoot.width;
  delete cleanRoot.height;
  delete cleanRoot.viewBox;

  return {
    canvas: { width, height, viewBox },
    rootAttrs: cleanRoot,
    defs: defsParts.join('\n'),
    order,
    nodes,
  };
}

/** Convenience: reads just the dimensions, e.g. for the projects screen. */
export function readSvgSize(source: string): { width: number; height: number } {
  try {
    const parsed = parseSvg(source);
    return { width: parsed.canvas.width, height: parsed.canvas.height };
  } catch {
    return { width: 512, height: 512 };
  }
}
