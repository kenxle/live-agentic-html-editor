/*
 * read-when: Changing how text with its breaks is read from markup, plain text or a live node.
 */

const NOT_BUILT = "C2: not built yet";

export interface TextSourceNode {
  readonly nodeType: number;
  readonly firstChild?: TextSourceNode | null;
  readonly nextSibling?: TextSourceNode | null;
  readonly tagName?: string;
  readonly data?: string;
  readonly nodeValue?: string | null;
  readonly getAttribute?: (name: string) => string | null;
}
export interface BlockTextOptions {
  readonly skip?: (node: TextSourceNode) => boolean;
}

export function blockText(html: string): string {
  throw new Error(NOT_BUILT + html);
}
export function blockTextFromNode(node: TextSourceNode, options?: BlockTextOptions): string {
  throw new Error(NOT_BUILT + String(node.nodeType) + String(options?.skip));
}
export function textOf(value: string): string {
  throw new Error(NOT_BUILT + value);
}
export function topLevelBlocks(html: string): readonly string[] | null {
  throw new Error(NOT_BUILT + html);
}
