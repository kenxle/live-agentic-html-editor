/*
 * read-when: Changing how a data: URL value is recognized or named.
 */

const NOT_BUILT = "C2: not built yet";

export function isEmbeddedValue(value: string): boolean {
  throw new Error(NOT_BUILT + value);
}
export function embeddedName(value: string): string {
  throw new Error(NOT_BUILT + value);
}
