/*
 * read-when: Narrowing a parsed JSON value to an object before reading fields off it.
 */

export type JsonObject = Readonly<Record<string, unknown>>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
