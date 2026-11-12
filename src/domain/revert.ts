/*
 * read-when: An undo of a handled edit, delete, format change or run asks the agent for the wrong thing.
 */

import type { Context, Item, Region } from "../contract/record.ts";

export const REVERT_EDIT =
  "Undo: the reviewer took this change back. Remove it from the source, so the passage reads as it did before.";
export const REVERT_DELETE = "Undo: the reviewer put this block back. Restore it in the source; it should not have been deleted.";
export const REVERT_FORMAT = "Undo: the reviewer took this formatting change back. Put the markup back the way the source had it.";
export const RUN_TAKEBACK_LINE = "Remove the blocks in remove_blocks from after this {type}; the reviewer undid them.";
export const RUN_TAKEBACK_TAG_LINE =
  "Change this {type} back to {tag}, the tag in anchor_tag_after; the reviewer undid the type change.";

export interface RevertPlacement {
  readonly region?: Region | null;
  readonly context?: Context | null;
  readonly created_at?: string;
}

function notBuilt(...args: readonly unknown[]): Error {
  return new Error("C3: not built yet " + String(args.length));
}

export function revertOf(item: Item, extra?: RevertPlacement): Item {
  throw notBuilt(item, extra);
}
export function takenBackIds(items: readonly Item[] | null | undefined): ReadonlySet<string> {
  throw notBuilt(items);
}
