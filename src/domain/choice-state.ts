/*
 * read-when: A choice group on the page shows the wrong state or the wrong press.
 */

import type { ChoiceState, ChoiceToken } from "../contract/choice.ts";
import type { Item } from "../contract/record.ts";

function notBuilt(...args: readonly unknown[]): Error {
  return new Error("C3: not built yet " + String(args.length));
}

export function choiceStateOf(item: Item | null | undefined, kept: boolean): ChoiceState {
  throw notBuilt(item, kept);
}
export function latestChoiceByGroup(items: readonly Item[] | null | undefined): ReadonlyMap<ChoiceToken, Item> {
  throw notBuilt(items);
}
