/*
 * read-when: A collision the reviewer already answered with Keep mine comes back.
 */

import type { Item } from "../contract/record.ts";

export const ACCEPTED_PAGE_TEXTS_MAX = 8;

function notBuilt(...args: readonly unknown[]): Error {
  return new Error("C3: not built yet " + String(args.length));
}

export function acceptedPageTexts(item: Pick<Item, "region"> | null | undefined): readonly string[] {
  throw notBuilt(item);
}
export function acceptPageText(item: Item | null | undefined, text: string): readonly string[] {
  throw notBuilt(item, text);
}
