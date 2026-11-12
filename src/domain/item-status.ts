/*
 * read-when: A count, a list or a badge disagrees with another about which items are waiting.
 */

import type { Item } from "../contract/record.ts";

function notBuilt(...args: readonly unknown[]): Error {
  return new Error("C3: not built yet " + String(args.length));
}

export function isDraft(item: Pick<Item, "state">): boolean {
  throw notBuilt(item);
}
export function isReady(item: Pick<Item, "state">): boolean {
  throw notBuilt(item);
}
export function isOutstanding(item: Pick<Item, "state">): boolean {
  throw notBuilt(item);
}
export function isUnansweredReady(item: Item | null | undefined): boolean {
  throw notBuilt(item);
}
export function isReplayable(item: Item | null | undefined): boolean {
  throw notBuilt(item);
}
export function isClosedByReviewer(item: Pick<Item, "state" | "closed_by"> | null | undefined): boolean {
  throw notBuilt(item);
}
