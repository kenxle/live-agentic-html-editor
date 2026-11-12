/*
 * read-when: A count, a list or a badge disagrees with another about which items are waiting.
 */

import { CLOSED_BY_REVIEWER, STATE } from "../contract/record.ts";
import type { Item } from "../contract/record.ts";
import { toolRoundOf } from "./tool-round.ts";

export function isDraft(item: Pick<Item, "state">): boolean {
  return item.state === STATE.DRAFT;
}

export function isReady(item: Pick<Item, "state">): boolean {
  return item.state === STATE.READY;
}

export function isOutstanding(item: Pick<Item, "state">): boolean {
  return item.state === STATE.READY || item.state === STATE.NOT_HANDLED;
}

export function isUnansweredReady(item: Item | null | undefined): boolean {
  if (!item || item.state !== STATE.READY) return false;
  if (item.handled_not_on_page) return true;
  return !item.reply;
}

export function isReplayable(item: Item | null | undefined): boolean {
  if (!item || item.state !== STATE.READY) return false;
  return toolRoundOf(item) === null;
}

export function isClosedByReviewer(item: Pick<Item, "state" | "closed_by"> | null | undefined): boolean {
  return !!item && item.state === STATE.HANDLED && item.closed_by === CLOSED_BY_REVIEWER;
}
