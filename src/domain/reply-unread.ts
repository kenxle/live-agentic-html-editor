/*
 * read-when: The "1 new" tag, the menu bar's "waiting on you" or a toast counts a reply it should not, or misses one.
 */

import type { FoldedReply, Item } from "../contract/record.ts";

export type ReadMarks = Readonly<Partial<Record<string, string>>>;

function notBuilt(...args: readonly unknown[]): Error {
  return new Error("C3: not built yet " + String(args.length));
}

export function replyStamp(item: Pick<Item, "reply" | "rev"> | null | undefined): string | null {
  throw notBuilt(item);
}
export function hasWords(value: unknown): value is string {
  throw notBuilt(value);
}
export function needsToSeeReply(reply: FoldedReply | null | undefined): boolean {
  throw notBuilt(reply);
}
export function isUnreadReply(item: Item | null | undefined, mark?: string): boolean {
  throw notBuilt(item, mark);
}
export function unseenReplyIds(items: readonly Item[] | null | undefined, marks?: ReadMarks | null): string[] {
  throw notBuilt(items, marks);
}
