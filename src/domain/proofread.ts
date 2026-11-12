/*
 * read-when: The reviewer's "Use the fixes" changes the wrong words, loses formatting, or is refused.
 */

import type { FailureCode } from "../contract/failures.ts";
import type { Item } from "../contract/record.ts";

export const USE_FIXES_CHANGE =
  "The reviewer took your proofreading fixes, {n} in all. In the source, replace each fix's from words with its to words in the block you already placed, in place, so it matches new_blocks; do not add any block again. The fixes are listed as block, from and to under suggestions in the thread's last agent turn.";

export interface SuggestionRefusal {
  readonly code: Extract<FailureCode, "SUGGESTION_NOT_FOUND">;
  readonly reason: string;
}

export function applySuggestions(item: Item, suggestions: readonly unknown[] | null | undefined): Item | SuggestionRefusal {
  throw new Error("C3: not built yet " + item.id + String(suggestions?.length));
}
