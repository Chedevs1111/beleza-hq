// DOM building for the dashboard pages. Strings become text nodes and are never parsed as HTML, so draft, lead and
// inbox text containing markup shows up literally. Every page builds its DOM with this.

type DocLike = Pick<Document, 'createElement' | 'createTextNode'>;

export type HFn = (tag: string, attrs?: Record<string, string>, ...children: (Node | string)[]) => HTMLElement;

/** `h` against a given document (the tests pass a minimal fake one). Inline `on*` handler attributes are never set. */
export function hIn(
  doc: DocLike,
  tag: string,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElement {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (/^on/i.test(k)) continue;
    el.setAttribute(k, v);
  }
  for (const c of children) el.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c);
  return el;
}

export const h: HFn = (tag, attrs, ...children) => hIn(document, tag, attrs, ...children);
