/*
 * read-when: Changing what a new record holds, how a rewording bumps the revision, or what replay's history compares against.
 */

import type { ChoicePress } from "../contract/choice.ts";
import { RUN_HISTORY_KEEP } from "../contract/run-limits.ts";
import { FIELD, KIND, KINDS, STATE, emptyContext, emptyRegion, hasRunFields, isKind, isRunRecord } from "../contract/record.ts";
import type { Context, FoldedReply, HistoryEntry, Item, ItemState, Kind, Placement, Region, RunBlock, SourceHint, ThreadRound } from "../contract/record.ts";
import { modeFor } from "./comparison.ts";
import type { ComparisonMode } from "./comparison.ts";
import { nowIso, randomId } from "./mint.ts";
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

function copyBlocks(blocks: readonly RunBlock[]): RunBlock[] {
  return blocks.map((block) => ({ ...block }));
}

function copyEntry(entry: HistoryEntry): HistoryEntry {
  return {
    ...entry,
    ...(entry.new_blocks === undefined ? {} : { new_blocks: copyBlocks(entry.new_blocks) })
  };
}

function isList<T>(value: readonly T[] | null | undefined): value is readonly T[] {
  return Array.isArray(value);
}

function listOf<T>(value: readonly T[] | null | undefined): readonly T[] {
  return isList(value) ? value : [];
}

export function historyEntry(item: Item, at: string): HistoryEntry {
  const run = hasRunFields(item);
  return {
    rev: item.rev,
    after: typeof item.after === "string" ? item.after : null,
    after_html: typeof item.after_html === "string" ? item.after_html : null,
    at,
    ...(run && item.new_blocks !== undefined ? { new_blocks: copyBlocks(item.new_blocks) } : {}),
    ...(run && item.anchor_after_html !== undefined ? { anchor_after_html: item.anchor_after_html } : {}),
    ...(run && item.anchor_tag_after !== undefined ? { anchor_tag_after: item.anchor_tag_after } : {}),
    ...(run && item.placement !== undefined ? { placement: item.placement } : {})
  };
}

export function newItem(input: NewItemInput): Item {
  if (!isKind(input.kind)) {
    throw new Error("newItem: kind must be one of " + KINDS.join(", ") + ", got " + String(input.kind));
  }
  const page = input.page ?? {};
  const origin = input.page_origin || page.origin;
  const path = input.page_path || page.path;
  if (typeof origin !== "string" || origin === "") {
    throw new Error("newItem: page_origin is required; review.json is grouped by origin plus path");
  }
  if (typeof path !== "string" || path === "") {
    throw new Error("newItem: page_path is required; review.json is grouped by origin plus path");
  }
  const at = input.created_at || nowIso();
  const item: Item = {
    id: input.id || randomId("itm"),
    rev: typeof input.rev === "number" ? input.rev : 1,
    kind: input.kind,
    state: input.state || STATE.DRAFT,
    note: typeof input.note === "string" ? input.note : null,
    change: typeof input.change === "string" ? input.change : null,
    before: typeof input.before === "string" ? input.before : null,
    after: typeof input.after === "string" ? input.after : null,
    before_html: typeof input.before_html === "string" ? input.before_html : null,
    after_html: typeof input.after_html === "string" ? input.after_html : null,
    after_history: listOf(input.after_history).map(copyEntry),
    region: input.region || emptyRegion(),
    context: input.context || emptyContext(),
    page_origin: origin,
    page_path: path,
    page_title: input.page_title || page.title || null,
    page_seq: typeof input.page_seq === "number" ? input.page_seq : typeof page.seq === "number" ? page.seq : null,
    source_hint: input.source_hint || page.source_hint || null,
    reverts: typeof input.reverts === "string" && input.reverts !== "" ? input.reverts : null,
    reply: input.reply || null,
    handled_not_on_page: input.handled_not_on_page === true,
    thread: [...listOf(input.thread)],
    created_at: at,
    updated_at: input.updated_at || at
  };
  if (input.new_blocks !== undefined) item.new_blocks = copyBlocks(input.new_blocks);
  if (input.anchor_after_html !== undefined) item.anchor_after_html = input.anchor_after_html;
  if (input.anchor_tag_after !== undefined) item.anchor_tag_after = input.anchor_tag_after;
  if (input.placement !== undefined) item.placement = input.placement;
  if (input.remove_blocks !== undefined) item.remove_blocks = copyBlocks(input.remove_blocks);
  if (input.choice !== undefined) item.choice = { ...input.choice };
  if (item.after_history.length === 0 && typeof item.after === "string") item.after_history = [historyEntry(item, at)];
  return item;
}

function trimRunHistory(history: readonly HistoryEntry[]): HistoryEntry[] {
  const cut = history.length - RUN_HISTORY_KEEP;
  return history.map((entry, index) => {
    if (index >= cut) return entry;
    return {
      rev: entry.rev,
      after: entry.after,
      after_html: null,
      at: entry.at,
      ...(entry.anchor_after_html === undefined ? {} : { anchor_after_html: entry.anchor_after_html }),
      ...(entry.anchor_tag_after === undefined ? {} : { anchor_tag_after: entry.anchor_tag_after }),
      ...(entry.placement === undefined ? {} : { placement: entry.placement })
    };
  });
}

export function bumpRev(item: Item, changes: ItemChanges = {}): Item {
  const next: Item = { ...item, ...changes, rev: item.rev + 1, updated_at: nowIso() };
  delete next.closed_by;
  delete next.closed_at;
  const history = [...listOf(item.after_history)];
  const last = history[history.length - 1];
  const afterMoved = typeof next.after === "string" && (last === undefined || last.after !== next.after);
  const htmlMoved = typeof next.after_html === "string" && (last === undefined || last.after_html !== next.after_html);
  const tagMoved = last !== undefined && hasRunFields(next) && (last.anchor_tag_after ?? null) !== (next.anchor_tag_after ?? null);
  if (afterMoved || htmlMoved || tagMoved) history.push(historyEntry(next, next.updated_at));
  next.after_history = isRunRecord(next) ? trimRunHistory(history) : history;
  return next;
}

export function priorAfters(item: Item, field: ComparedField = FIELD.AFTER): readonly string[] {
  const current = item[field];
  const out: string[] = [];
  for (const entry of listOf(item.after_history)) {
    const value = entry[field];
    if (typeof value !== "string" || value === current || out.includes(value)) continue;
    out.push(value);
  }
  return out;
}

export function comparisonMode(item: Pick<Item, "kind">): ComparisonMode {
  return modeFor(item.kind);
}

export function comparisonFields(item: Pick<Item, "kind">): ComparisonFields {
  return item.kind === KIND.FORMAT_ONLY
    ? { before: FIELD.BEFORE_HTML, after: FIELD.AFTER_HTML }
    : { before: FIELD.BEFORE, after: FIELD.AFTER };
}
