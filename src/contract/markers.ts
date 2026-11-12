/*
 * read-when: Changing an attribute, class or id that marks what Lahe added to a page, or checking whether a node is Lahe's.
 */

export type ToolAttribute = `data-lahe${string}`;

type Stripped<Name extends ToolAttribute> = Name;

export const TOOL_ATTR: Stripped<"data-lahe"> = "data-lahe";
export const STAMP_ATTR: Stripped<"data-lahe-id"> = "data-lahe-id";
export const PROTECTED_ATTR: Stripped<"data-lahe-protected"> = "data-lahe-protected";
export const FILE_TITLE_ATTR: Stripped<"data-lahe-file-title"> = "data-lahe-file-title";
export const EDIT_HOST_ATTR: Stripped<"data-lahe-edit-host"> = "data-lahe-edit-host";
export const FILE_TITLE_VALUE = "file-name";
export const ROLE_CHROME = "chrome";
export const ROLE_WRAP = "wrap";
export const OVERLAY_ROOT_ID = "lahe-surface-root";
export const TURBO_PERMANENT_ATTR = "data-turbo-permanent";
export const AUTHOR_REGION_ATTR = "data-review-region";
export const RENDER_NOTE_NAME = "lahe-render-note";

export type ToolRole = typeof ROLE_CHROME | typeof ROLE_WRAP;

export interface MarkedNode {
  readonly nodeType?: number;
  readonly id?: string;
  readonly parentNode?: MarkedNode | null;
  getAttribute?(name: string): string | null;
}

export interface AttributeWriter {
  setAttribute(name: string, value: string): void;
}

const TOOL_ATTR_PREFIX = "data-lahe";
const TOOL_CLASS_PREFIX = "lahe-";
const ELEMENT_NODE = 1;

export function isToolAttrName(name: string): boolean {
  return name.toLowerCase().startsWith(TOOL_ATTR_PREFIX);
}

export function isToolClassToken(token: string): boolean {
  return token.startsWith(TOOL_CLASS_PREFIX);
}

export function roleOf(node: MarkedNode | null): ToolRole | null {
  const value = node?.getAttribute?.(TOOL_ATTR);
  return value === ROLE_CHROME || value === ROLE_WRAP ? value : null;
}

export function isToolNode(node: MarkedNode | null): boolean {
  return roleOf(node) !== null;
}

export function isInsideOverlay(node: MarkedNode | null): boolean {
  let current: MarkedNode | null | undefined = node;
  while (current?.nodeType === ELEMENT_NODE) {
    if (current.id === OVERLAY_ROOT_ID || isToolNode(current)) return true;
    current = current.parentNode;
  }
  return false;
}

export function isFileTitle(node: MarkedNode | null): boolean {
  return node?.getAttribute?.(FILE_TITLE_ATTR) === FILE_TITLE_VALUE;
}

export function markChrome<T extends AttributeWriter>(el: T): T {
  el.setAttribute(TOOL_ATTR, ROLE_CHROME);
  return el;
}
