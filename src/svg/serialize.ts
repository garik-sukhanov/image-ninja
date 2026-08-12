import type { SvgDocument, SvgNode } from '../types';

/** Attributes that only exist for the editor and must not reach the file. */
const EDITOR_ATTRS = new Set(['data-nid']);

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function serializeAttrs(attrs: Record<string, string>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (EDITOR_ATTRS.has(key) || value === undefined || value === null) continue;
    parts.push(`${key}="${escapeAttr(value)}"`);
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

function serializeNode(node: SvgNode, nodes: Record<string, SvgNode>, indent: string): string {
  if (node.hidden) {
    // Hidden layers stay in the file but keep their visibility off, so the
    // document round-trips instead of silently losing content on export.
    node = { ...node, attrs: { ...node.attrs, display: 'none' } };
  }

  const open = `${indent}<${node.tag}${serializeAttrs(node.attrs)}`;

  if (node.children) {
    if (node.children.length === 0) return `${open} />`;
    const inner = node.children
      .map((id) => (nodes[id] ? serializeNode(nodes[id], nodes, `${indent}  `) : ''))
      .filter(Boolean)
      .join('\n');
    return `${open}>\n${inner}\n${indent}</${node.tag}>`;
  }

  if (node.text) return `${open}>${node.text}</${node.tag}>`;
  return `${open} />`;
}

export interface SerializeOptions {
  /** Strip editor-only bookkeeping and hidden layers entirely. */
  clean?: boolean;
  indent?: string;
}

export function serializeSvg(doc: SvgDocument, opts: SerializeOptions = {}): string {
  const indent = opts.indent ?? '  ';
  const { canvas, rootAttrs, defs, order, nodes } = doc;

  const attrs: Record<string, string> = {
    xmlns: 'http://www.w3.org/2000/svg',
    ...rootAttrs,
    width: String(round(canvas.width)),
    height: String(round(canvas.height)),
    viewBox: canvas.viewBox.map(round).join(' '),
  };

  const visible = opts.clean ? order.filter((id) => !nodes[id]?.hidden) : order;
  const body = visible
    .map((id) => (nodes[id] ? serializeNode(nodes[id], nodes, indent) : ''))
    .filter(Boolean)
    .join('\n');

  const defsBlock = defs.trim()
    ? `\n${defs.trim().split('\n').map((l) => indent + l.trim()).join('\n')}`
    : '';

  return `<svg${serializeAttrs(attrs)}>${defsBlock}\n${body}\n</svg>\n`;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Serializes a subtree — used by copy/paste and by "export selection". */
export function serializeSubtree(
  ids: string[],
  nodes: Record<string, SvgNode>,
  viewBox: [number, number, number, number],
  defs: string,
): string {
  const body = ids
    .map((id) => (nodes[id] ? serializeNode(nodes[id], nodes, '  ') : ''))
    .filter(Boolean)
    .join('\n');
  const defsBlock = defs.trim() ? `\n  ${defs.trim()}` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.join(' ')}">${defsBlock}\n${body}\n</svg>\n`;
}
