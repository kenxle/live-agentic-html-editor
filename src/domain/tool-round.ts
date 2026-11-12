/*
 * read-when: The rail shows, or hides, a page-check exchange, or a card sits in the wrong tab.
 */

import { isJsonObject } from "../contract/json-object.ts";
import { STATE, isToolRoundName } from "../contract/record.ts";
import type { CheckReopen, Item, ItemState, ThreadRound, ToolRoundName } from "../contract/record.ts";

export function pageCheckReopen(item: Pick<Item, "region"> | null | undefined): CheckReopen | null {
  const region = item?.region;
  if (!isJsonObject(region)) return null;
  const stamp = region.check_reopen;
  return isJsonObject(stamp) ? stamp : null;
}

export function toolRoundOf(item: Item | null | undefined): ToolRoundName | null {
  const stamp = pageCheckReopen(item);
  if (!item || !stamp || typeof stamp.rev !== "number" || stamp.rev !== item.rev) return null;
  return isToolRoundName(stamp.tool) ? stamp.tool : null;
}

export function isToolRound(round: Pick<ThreadRound, "tool"> | null | undefined): boolean {
  return !!round && isToolRoundName(round.tool);
}

export function answeredPageCheckReopen(item: Item | null | undefined): boolean {
  const stamp = pageCheckReopen(item);
  return !!item && !!stamp && typeof stamp.rev === "number" && stamp.rev === item.rev;
}

export function displayState(item: Item | null | undefined): ItemState | null {
  if (!item) return null;
  return toolRoundOf(item) === null ? item.state : STATE.HANDLED;
}
