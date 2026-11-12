/*
 * read-when: Changing the bold and italic vocabulary, or how a style attribute states not bold or not italic.
 */

const NOT_BUILT = "C2: not built yet";

export const NOT_BOLD_TAG = "not-bold";
export const NOT_ITALIC_TAG = "not-italic";
export const RESET_TAGS: { readonly bold: "not-bold"; readonly italic: "not-italic" } = {
  bold: NOT_BOLD_TAG,
  italic: NOT_ITALIC_TAG
};
export type ResetTag = (typeof RESET_TAGS)[keyof typeof RESET_TAGS];
export const STRUCTURAL_TAGS: readonly ["em", "strong", "not-bold", "not-italic"] = ["em", "strong", NOT_BOLD_TAG, NOT_ITALIC_TAG];
export type StructuralTag = (typeof STRUCTURAL_TAGS)[number];
export function isStructuralTag(name: string): name is StructuralTag {
  throw new Error(NOT_BUILT + name);
}
export function isNotBoldWeight(value: string): boolean {
  throw new Error(NOT_BUILT + value);
}
export function isNotItalicStyle(value: string): boolean {
  throw new Error(NOT_BUILT + value);
}
export function resetTagsForStyle(style: string): readonly ResetTag[] {
  throw new Error(NOT_BUILT + style);
}
