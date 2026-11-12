/*
 * read-when: An undo of a handled edit, delete, format change or run asks the agent for the wrong thing.
 */

import { KIND, PLACEMENT, STATE, hasRunFields, isRevert, isRunRecord } from "../contract/record.ts";
import type { Context, Item, Kind, Region } from "../contract/record.ts";
import { newItem } from "./item-revisions.ts";
import { anchorTagOf, anchorTypeName, anchorTypeOfTag } from "./run-record.ts";
import { isWritableBlockTag } from "./run-blocks.ts";

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

const REVERT_SENTENCE: { readonly [Name in Kind]: string } = {
  comment: REVERT_EDIT,
  edit: REVERT_EDIT,
  delete: REVERT_DELETE,
  format_only: REVERT_FORMAT,
  note: REVERT_EDIT,
  choice: REVERT_EDIT
};

function textOrEmpty(value: string | null): string {
  return typeof value === "string" ? value : "";
}

function textOrNull(value: string | null): string | null {
  return typeof value === "string" ? value : null;
}

function runRevertOf(item: Item, extra: RevertPlacement): Item {
  const type = anchorTypeName(item);
  const lines = [REVERT_SENTENCE[item.kind]];
  if (isRunRecord(item)) lines.push(RUN_TAKEBACK_LINE.replace("{type}", type));
  const newTag = item.anchor_tag_after;
  const found = typeof newTag === "string" && newTag !== "" ? anchorTagOf(item) : null;
  const oldTag = found !== null && found !== newTag && isWritableBlockTag(found) ? found : null;
  if (oldTag !== null) {
    lines.push(RUN_TAKEBACK_TAG_LINE.replace("{type}", anchorTypeOfTag(newTag)).replace("{tag}", oldTag));
  }
  const created = extra.created_at;
  const back = newItem({
    kind: item.kind === KIND.FORMAT_ONLY ? KIND.FORMAT_ONLY : KIND.EDIT,
    state: STATE.READY,
    change: lines.join(" "),
    before: textOrEmpty(item.after),
    after: textOrEmpty(item.before),
    before_html: textOrNull(item.after_html),
    after_html: textOrNull(item.before_html),
    reverts: item.id,
    ...(item.new_blocks === undefined ? {} : { remove_blocks: item.new_blocks }),
    placement: item.placement || PLACEMENT.AFTER_ANCHOR,
    region: extra.region || item.region,
    context: extra.context || item.context,
    page_origin: item.page_origin,
    page_path: item.page_path,
    page_title: item.page_title,
    page_seq: item.page_seq,
    source_hint: item.source_hint,
    ...(created ? { created_at: created } : {})
  });
  if (oldTag !== null) back.anchor_tag_after = oldTag;
  return back;
}

export function revertOf(item: Item, extra: RevertPlacement = {}): Item {
  if (hasRunFields(item)) return runRevertOf(item, extra);
  const isDelete = item.kind === KIND.DELETE;
  const created = extra.created_at;
  return newItem({
    kind: isDelete ? KIND.EDIT : item.kind,
    state: STATE.READY,
    change: REVERT_SENTENCE[item.kind],
    before: isDelete ? "" : textOrEmpty(item.after),
    after: textOrEmpty(item.before),
    before_html: isDelete ? "" : textOrNull(item.after_html),
    after_html: textOrNull(item.before_html),
    reverts: item.id,
    region: extra.region ?? null,
    context: extra.context ?? null,
    page_origin: item.page_origin,
    page_path: item.page_path,
    page_title: item.page_title,
    page_seq: item.page_seq,
    source_hint: item.source_hint,
    ...(created ? { created_at: created } : {})
  });
}

export function takenBackIds(items: readonly Item[] | null | undefined): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const item of items ?? []) {
    if (isRevert(item) && item.reverts !== null) ids.add(item.reverts);
  }
  return ids;
}
