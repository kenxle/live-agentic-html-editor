/*
 * read-when: A choice group on the page shows the wrong state or the wrong press.
 */

import { CHOICE_STATE, isChoiceToken } from "../contract/choice.ts";
import type { ChoiceState, ChoiceToken } from "../contract/choice.ts";
import { REPLY_STATUS, STATE, isChoice } from "../contract/record.ts";
import type { Item } from "../contract/record.ts";

export function choiceStateOf(item: Item | null | undefined, kept: boolean): ChoiceState {
  const state = item?.state;
  if (state === STATE.HANDLED) return CHOICE_STATE.DONE;
  if (state === STATE.NOT_HANDLED) return CHOICE_STATE.NOT_HANDLED;
  if (kept || state === STATE.DRAFT) return CHOICE_STATE.KEPT;
  return item?.reply?.status === REPLY_STATUS.QUESTION ? CHOICE_STATE.QUESTION : CHOICE_STATE.OPEN;
}

export function latestChoiceByGroup(items: readonly Item[] | null | undefined): ReadonlyMap<ChoiceToken, Item> {
  const latest = new Map<ChoiceToken, Item>();
  for (const item of items ?? []) {
    if (!isChoice(item)) continue;
    const group = item.choice?.group;
    if (!isChoiceToken(group)) continue;
    const held = latest.get(group);
    if (held === undefined || (item.created_at || "") >= (held.created_at || "")) latest.set(group, item);
  }
  return latest;
}
