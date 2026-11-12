/*
 * read-when: The "1 new" tag, the menu bar's "waiting on you" or a toast counts a reply it should not, or misses one.
 */

import { isJsonObject } from "../contract/json-object.ts";
import { REPLY_STATUS } from "../contract/record.ts";
import type { FoldedReply, Item } from "../contract/record.ts";
import { isClosedByReviewer } from "./item-status.ts";
import { toolRoundOf } from "./tool-round.ts";

export type ReadMarks = Readonly<Partial<Record<string, string>>>;

export function replyStamp(item: Pick<Item, "reply" | "rev"> | null | undefined): string | null {
  if (!item?.reply) return null;
  return (item.reply.at || "") + "@" + (typeof item.rev === "number" ? String(item.rev) : "");
}

export function hasWords(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function needsToSeeReply(reply: FoldedReply | null | undefined): boolean {
  if (!reply) return false;
  if (reply.status === REPLY_STATUS.QUESTION || reply.status === REPLY_STATUS.NOT_HANDLED) return true;
  if (reply.user_needs_to_see_reply !== true) return false;
  return hasWords(reply.text) || hasWords(reply.reason);
}

export function isUnreadReply(item: Item | null | undefined, mark?: string): boolean {
  const stamp = replyStamp(item);
  if (!item || stamp === null) return false;
  if (toolRoundOf(item) !== null || isClosedByReviewer(item)) return false;
  if (!needsToSeeReply(item.reply)) return false;
  if (item.reply_seen === stamp) return false;
  return mark !== stamp;
}

export function unseenReplyIds(items: readonly Item[] | null | undefined, marks?: ReadMarks | null): string[] {
  const seen: ReadMarks = isJsonObject(marks) ? marks : {};
  const out: string[] = [];
  for (const item of items ?? []) {
    const mark = Object.hasOwn(seen, item.id) ? seen[item.id] : undefined;
    if (isUnreadReply(item, mark)) out.push(item.id);
  }
  return out;
}
