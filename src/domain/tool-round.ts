/*
 * read-when: The rail shows, or hides, a page-check exchange, or a card sits in the wrong tab.
 */

import type { CheckReopen, Item, ItemState, ThreadRound, ToolRoundName } from "../contract/record.ts";

function notBuilt(...args: readonly unknown[]): Error {
  return new Error("C3: not built yet " + String(args.length));
}

export function pageCheckReopen(item: Pick<Item, "region"> | null | undefined): CheckReopen | null {
  throw notBuilt(item);
}
export function toolRoundOf(item: Item | null | undefined): ToolRoundName | null {
  throw notBuilt(item);
}
export function isToolRound(round: Pick<ThreadRound, "tool"> | null | undefined): boolean {
  throw notBuilt(round);
}
export function answeredPageCheckReopen(item: Item | null | undefined): boolean {
  throw notBuilt(item);
}
export function displayState(item: Item | null | undefined): ItemState | null {
  throw notBuilt(item);
}
