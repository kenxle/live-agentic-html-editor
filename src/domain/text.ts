/*
 * read-when: Changing how text is normalized for recording or comparing, or when a region fails to match its record.
 */

export const LINE_BREAK = "\n";
export const PARAGRAPH_BREAK = "\n\n";
export type TextBreak = typeof LINE_BREAK | typeof PARAGRAPH_BREAK;

const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const INVISIBLES = /[\u200B\uFEFF\u00AD]/g;
const SPACE_RUN = /[\t\n\r \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;
const HORIZONTAL_SPACE_RUN = /[\t \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;

export function cleanCharacters(input: string): string {
  return input.normalize("NFC").replace(CONTROLS, "").replace(INVISIBLES, "");
}

export function collapseSpaces(input: string): string {
  return input.replace(SPACE_RUN, " ");
}

export function normalizeText(input: string): string {
  return collapseSpaces(cleanCharacters(input)).trim();
}

export function normalizeBlockText(input: string): string {
  return cleanCharacters(input)
    .replace(/\r\n?/g, LINE_BREAK)
    .replace(HORIZONTAL_SPACE_RUN, " ")
    .replace(/ ?\n ?/g, LINE_BREAK)
    .replace(/\n{3,}/g, PARAGRAPH_BREAK)
    .trim();
}

export function foldTypography(input: string): string {
  return normalizeText(input)
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/\u2026/g, "...");
}

export function firstWords(text: string | null | undefined, max: number, more = ""): string {
  const words = normalizeText(text ?? "")
    .split(" ")
    .filter((word) => word !== "");
  return words.length > max ? words.slice(0, max).join(" ") + more : words.join(" ");
}
