/*
 * read-when: Changing what a new record holds, how a rewording bumps the revision, or what replay's history compares against.
 */

import type { ChoicePress } from "../contract/choice.ts";
import { FIELD } from "../contract/record.ts";
import type { Context, FoldedReply, HistoryEntry, Item, ItemState, Kind, Placement, Region, RunBlock, SourceHint, ThreadRound } from "../contract/record.ts";
import type { ComparisonMode } from "./comparison.ts";
import type { PageView } from "./page-identity.ts";

export interface NewItemInput {
  readonly kind: Kind;
  readonly id?: string;
  readonly rev?: number;
  readonly state?: ItemState;
  readonly note?: string | null;
  readonly change?: string | null;
  readonly before?: string | null;
  readonly after?: string | null;
  readonly before_html?: string | null;
  readonly after_html?: string | null;
  readonly after_history?: readonly HistoryEntry[];
  readonly region?: Region | null;
  readonly context?: Context | null;
  readonly page?: Partial<Pick<PageView, "origin" | "path" | "title" | "seq" | "source_hint">>;
  readonly page_origin?: string;
  readonly page_path?: string;
  readonly page_title?: string | null;
  readonly page_seq?: number | null;
  readonly source_hint?: SourceHint | null;
  readonly reverts?: string | null;
  readonly reply?: FoldedReply | null;
  readonly handled_not_on_page?: boolean;
  readonly thread?: readonly ThreadRound[];
  readonly created_at?: string;
  readonly updated_at?: string;
  readonly new_blocks?: readonly RunBlock[];
  readonly anchor_after_html?: string | null;
  readonly anchor_tag_after?: string | null;
  readonly placement?: Placement;
  readonly remove_blocks?: readonly RunBlock[];
  readonly choice?: ChoicePress;
}

export type ItemChanges = Partial<Omit<Item, "rev" | "updated_at">>;
export type ComparedField = typeof FIELD.AFTER | typeof FIELD.AFTER_HTML;
export type ComparisonFields =
  | { readonly before: typeof FIELD.BEFORE; readonly after: typeof FIELD.AFTER }
  | { readonly before: typeof FIELD.BEFORE_HTML; readonly after: typeof FIELD.AFTER_HTML };

function notBuilt(...args: readonly unknown[]): Error {
  return new Error("C3: not built yet " + String(args.length));
}

export function newItem(input: NewItemInput): Item {
  throw notBuilt(input);
}
export function historyEntry(item: Item, at: string): HistoryEntry {
  throw notBuilt(item, at);
}
export function bumpRev(item: Item, changes?: ItemChanges): Item {
  throw notBuilt(item, changes);
}
export function priorAfters(item: Item, field?: ComparedField): readonly string[] {
  throw notBuilt(item, field);
}
export function comparisonFields(item: Pick<Item, "kind">): ComparisonFields {
  throw notBuilt(item);
}
export function comparisonMode(item: Pick<Item, "kind">): ComparisonMode {
  throw notBuilt(item);
}
