/*
 * read-when: Changing how a tag is read, or the tables of block, void and dropped elements.
 */

const NOT_BUILT = "C2: not built yet";

export interface TagAttribute {
  readonly name: string;
  readonly value: string;
}

export type TagToken =
  | {
      readonly kind: "start";
      readonly name: string;
      readonly attributes: readonly TagAttribute[];
      readonly selfClosing: boolean;
      readonly end: number;
    }
  | { readonly kind: "end"; readonly name: string; readonly end: number };

export type MarkupToken =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tag"; readonly tag: TagToken; readonly source: string };

export function readTag(html: string, at: number): TagToken | null {
  throw new Error(NOT_BUILT + html + String(at));
}
export function tokenizeMarkup(html: string): readonly MarkupToken[] {
  throw new Error(NOT_BUILT + html);
}
export function skipDeclaration(html: string, at: number): number | null {
  throw new Error(NOT_BUILT + html + String(at));
}
export function decodeEntities(text: string): string {
  throw new Error(NOT_BUILT + text);
}
export function nbspToSpace(text: string): string {
  throw new Error(NOT_BUILT + text);
}
export function escapeAttrValue(value: string): string {
  throw new Error(NOT_BUILT + value);
}

export const BLOCK_TAGS: readonly string[] = [];
export type BlockTag = string;
export function isBlockTag(name: string): name is BlockTag {
  throw new Error(NOT_BUILT + name);
}

export const DROP_SUBTREE_TAGS: readonly string[] = [];
export type DroppedSubtreeTag = string;
export function isDroppedSubtreeTag(name: string): name is DroppedSubtreeTag {
  throw new Error(NOT_BUILT + name);
}
export function isVoidTag(name: string): boolean {
  throw new Error(NOT_BUILT + name);
}
export function isWhitespacePreservingTag(name: string): boolean {
  throw new Error(NOT_BUILT + name);
}
