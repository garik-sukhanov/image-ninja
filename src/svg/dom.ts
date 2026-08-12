/** Id of the untransformed <g> that wraps the document content — the reference
 *  frame every canvas-space measurement is taken against. */
export const CONTENT_GROUP_ID = 'inj-content';

export function getContentGroup(): SVGGElement | null {
  return document.getElementById(CONTENT_GROUP_ID) as SVGGElement | null;
}
