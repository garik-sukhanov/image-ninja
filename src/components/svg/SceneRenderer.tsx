import { createElement, memo, type CSSProperties, type ReactElement } from 'react';
import type { SvgNode } from '../../types';

/**
 * Renders the scene graph as *real* SVG elements.
 *
 * Attributes are spread through untouched (React forwards hyphenated and
 * namespaced names via setAttribute), which is what keeps unknown-to-us
 * attributes — filters, markers, vendor extensions — working after a round
 * trip. Only `class` and `style` need translating into React's spelling.
 */

const SKIP = new Set(['class', 'style']);

function styleStringToObject(value: string): CSSProperties {
  const style: Record<string, string> = {};
  for (const decl of value.split(';')) {
    const idx = decl.indexOf(':');
    if (idx < 0) continue;
    const prop = decl.slice(0, idx).trim();
    const val = decl.slice(idx + 1).trim();
    if (!prop) continue;
    // React accepts custom properties verbatim and camelCases the rest.
    style[prop.startsWith('--') ? prop : camel(prop)] = val;
  }
  return style as CSSProperties;
}

function camel(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function toProps(node: SvgNode, interactive: boolean): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node.attrs)) {
    if (SKIP.has(key)) continue;
    props[key] = value;
  }
  if (node.attrs.class) props.className = node.attrs.class;
  if (node.attrs.style) props.style = styleStringToObject(node.attrs.style);
  if (node.hidden) props.style = { ...(props.style as CSSProperties), display: 'none' };

  props['data-nid'] = node.id;
  // Groups must not swallow clicks meant for their children, and locked layers
  // shouldn't respond at all.
  props.pointerEvents = !interactive || node.locked ? 'none' : node.tag === 'g' ? undefined : 'all';
  return props;
}

export const SceneNode = memo(function SceneNode({
  id,
  nodes,
  interactive = true,
}: {
  id: string;
  nodes: Record<string, SvgNode>;
  interactive?: boolean;
}): ReactElement | null {
  const node = nodes[id];
  if (!node) return null;

  const props = toProps(node, interactive);

  if (node.children) {
    return createElement(
      node.tag,
      { ...props, key: id },
      node.children.map((childId) => (
        <SceneNode key={childId} id={childId} nodes={nodes} interactive={interactive} />
      )),
    );
  }

  if (node.text !== undefined) {
    return createElement(node.tag, {
      ...props,
      key: id,
      dangerouslySetInnerHTML: { __html: node.text },
    });
  }

  return createElement(node.tag, { ...props, key: id });
});

export const Scene = memo(function Scene({
  order,
  nodes,
  defs,
  interactive = true,
}: {
  order: string[];
  nodes: Record<string, SvgNode>;
  defs: string;
  interactive?: boolean;
}) {
  return (
    <>
      {defs && <g dangerouslySetInnerHTML={{ __html: defs }} />}
      {order.map((id) => (
        <SceneNode key={id} id={id} nodes={nodes} interactive={interactive} />
      ))}
    </>
  );
});
