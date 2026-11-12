/*
 * read-when: Changing the bold and italic vocabulary of records, or how a style attribute states not bold or not italic.
 */

export const NOT_BOLD_TAG = "not-bold";
export const NOT_ITALIC_TAG = "not-italic";
export const RESET_TAGS: { readonly bold: "not-bold"; readonly italic: "not-italic" } = {
  bold: NOT_BOLD_TAG,
  italic: NOT_ITALIC_TAG
};
export type ResetTag = (typeof RESET_TAGS)[keyof typeof RESET_TAGS];
export const STRUCTURAL_TAGS: readonly ["em", "strong", "not-bold", "not-italic"] = [
  "em",
  "strong",
  NOT_BOLD_TAG,
  NOT_ITALIC_TAG
];
export type StructuralTag = (typeof STRUCTURAL_TAGS)[number];

const STRUCTURAL_TAG_SET: ReadonlySet<string> = new Set<string>(STRUCTURAL_TAGS);
const NOT_BOLD_WEIGHTS: ReadonlySet<string> = new Set<string>(["normal", "lighter", "100", "200", "300", "400", "500"]);

export function isStructuralTag(name: string): name is StructuralTag {
  return STRUCTURAL_TAG_SET.has(name);
}

export function isNotBoldWeight(value: string): boolean {
  return NOT_BOLD_WEIGHTS.has(value.trim().toLowerCase());
}

export function isNotItalicStyle(value: string): boolean {
  return value.trim().toLowerCase() === "normal";
}

function lastDeclaration(style: string, property: string): string {
  let found = "";
  for (const part of style.split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    if (part.slice(0, colon).trim().toLowerCase() !== property) continue;
    found = part.slice(colon + 1).trim().toLowerCase();
  }
  return found;
}

export function resetTagsForStyle(style: string): readonly ResetTag[] {
  const tags: ResetTag[] = [];
  if (isNotBoldWeight(lastDeclaration(style, "font-weight"))) tags.push(RESET_TAGS.bold);
  if (isNotItalicStyle(lastDeclaration(style, "font-style"))) tags.push(RESET_TAGS.italic);
  return tags;
}
