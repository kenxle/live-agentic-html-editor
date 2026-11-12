/*
 * read-when: The page check reopens an item, its sentence repeats in a note, or a reviewer sees tool text on their card.
 */

import type { CheckReopen, Item, ToolRoundName } from "../contract/record.ts";

export const PAGE_CHECK_STAMP_NOTE =
  "Reopened by the page check: the change landed but the data-lahe-id stamp did not reach the source. Write the stamp onto that element so the next build reproduces it, or reply not_handled saying why.";
export const LEGACY_PAGE_CHECK_NOTE =
  "Reopened by the page check: this handled change is no longer on the page and the original text is back. Reapply it, or reply not_handled saying why.";
export const PAGE_CHECK_NOTES: readonly [typeof PAGE_CHECK_STAMP_NOTE, typeof LEGACY_PAGE_CHECK_NOTE] = [
  PAGE_CHECK_STAMP_NOTE,
  LEGACY_PAGE_CHECK_NOTE
];

function notBuilt(...args: readonly unknown[]): Error {
  return new Error("C3: not built yet " + String(args.length));
}

export function appendNoteOnce(carried: string | null | undefined, sentence: string): string | null {
  throw notBuilt(carried, sentence);
}
export function stampPageCheckReopen(
  item: Item | null | undefined,
  stamp: string | null,
  at?: string | null,
  tool?: ToolRoundName | null
): CheckReopen | null {
  throw notBuilt(item, stamp, at, tool);
}
export function pageCheckReopenOf(item: Item, note: string, at?: string | null, tool?: ToolRoundName | null): Item {
  throw notBuilt(item, note, at, tool);
}
export function collapsePageCheckNote<T>(value: T): T {
  throw notBuilt(value);
}
export function reviewerNote(item: Pick<Item, "note"> | null | undefined): string | null {
  throw notBuilt(item);
}
