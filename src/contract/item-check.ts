/*
 * read-when: A record is refused before it is stored, or adding a rule every stored record must meet.
 */

import type { Item } from "./record.ts";

export function validateItem(value: unknown): asserts value is Item {
  throw new Error("C3: not built yet " + typeof value);
}
