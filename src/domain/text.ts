/*
 * read-when: Changing how text is normalized for comparing.
 */

export const LINE_BREAK = "\n";
export const PARAGRAPH_BREAK = "\n\n";
export type TextBreak = typeof LINE_BREAK | typeof PARAGRAPH_BREAK;

const NOT_BUILT = "C2: not built yet";

export function normalizeText(input: string): string {
  throw new Error(NOT_BUILT + input);
}
export function normalizeBlockText(input: string): string {
  throw new Error(NOT_BUILT + input);
}
export function foldTypography(input: string): string {
  throw new Error(NOT_BUILT + input);
}
export function firstWords(text: string | null | undefined, max: number, more?: string): string {
  throw new Error(NOT_BUILT + String(text) + String(max) + String(more));
}
export function cleanCharacters(input: string): string {
  throw new Error(NOT_BUILT + input);
}
export function collapseSpaces(input: string): string {
  throw new Error(NOT_BUILT + input);
}
