/*
 * read-when: The helper refuses a free-writing event, or changing what a run record may hold.
 */

import type { FailureCode } from "../contract/failures.ts";
import { isJsonObject } from "../contract/json-object.ts";
import { FIELD, hasRunFields, isPlacement } from "../contract/record.ts";
import type { RunBlock } from "../contract/record.ts";
import { NEW_BLOCKS_MAX, NEW_BLOCKS_MAX_BYTES, RUN_RECORD_MAX_BYTES } from "../contract/run-limits.ts";
import { utf8ByteLength } from "../contract/utf8.ts";
import { cleanMarkup } from "./clean-markup.ts";
import { blocksBytes, buildRunAfter, recordBytes } from "./run-record.ts";
import { cleanBlock, isWritableBlockTag } from "./run-blocks.ts";

export type RunRefusalCode = Extract<
  FailureCode,
  "RUN_BLOCK_REFUSED" | "RUN_OVER_CEILING" | "RUN_PLACEMENT_REFUSED" | "RUN_TAKEBACK_CARRIES_RUN"
>;
export interface RunRefusal {
  readonly code: RunRefusalCode;
  readonly reason: string;
}

type RecordFields = Readonly<Record<string, unknown>>;
type ParsedBlocks = { readonly blocks: readonly RunBlock[] } | { readonly refusal: string };

function spell(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function refuse(code: RunRefusalCode, reason: string): RunRefusal {
  return { code, reason };
}

function listOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseBlocks(list: readonly unknown[]): ParsedBlocks {
  const blocks: RunBlock[] = [];
  for (const [index, block] of list.entries()) {
    const at = "block " + String(index);
    if (!isJsonObject(block)) return { refusal: at + " is not an object" };
    const fromAnchor = block["from_anchor"];
    if (fromAnchor !== undefined && typeof fromAnchor !== "boolean") return { refusal: at + " from_anchor is not a boolean" };
    const tag = block["tag"];
    const html = block["html"];
    const cleaned = cleanBlock(tag, html);
    if (!("html" in cleaned)) return { refusal: at + ": " + cleaned.reason };
    if (typeof tag !== "string" || cleaned.html !== html || tag !== tag.toLowerCase()) return { refusal: at + " is not clean" };
    blocks.push(fromAnchor === undefined ? { tag, html: cleaned.html } : { tag, html: cleaned.html, from_anchor: fromAnchor });
  }
  return { blocks };
}

function cleanMarkupRefusal(name: string, html: string): string | null {
  if (utf8ByteLength(html) > NEW_BLOCKS_MAX_BYTES) return name + " is over the byte ceiling";
  if (cleanMarkup(html) !== html) return name + " is not clean";
  return null;
}

function sittingRefusal(record: RecordFields, run: readonly RunBlock[]): string | null {
  const anchorHtml = record[FIELD.ANCHOR_AFTER_HTML];
  if (typeof anchorHtml !== "string") return "anchor_after_html is not a string";
  const anchorProblem = cleanMarkupRefusal("anchor_after_html", anchorHtml);
  if (anchorProblem !== null) return anchorProblem;
  const built = buildRunAfter(anchorHtml, run);
  if (record[FIELD.AFTER_HTML] !== built.after_html) return "after_html is not anchor_after_html followed by new_blocks";
  if (record[FIELD.AFTER] !== built.after) return "after is not the words of after_html";
  return null;
}

function takeBackRefusal(record: RecordFields, remove: readonly RunBlock[]): string | null {
  const before = record[FIELD.BEFORE_HTML];
  if (typeof before !== "string") return "a take-back has no before_html";
  const tail = buildRunAfter("", remove).after_html;
  if (before.length < tail.length || !before.endsWith(tail)) return "before_html does not end with the blocks in remove_blocks";
  return cleanMarkupRefusal("the take-back's anchor markup", before.slice(0, before.length - tail.length));
}

export function validateRun(value: unknown): RunRefusal | null {
  if (!isJsonObject(value)) return refuse("RUN_BLOCK_REFUSED", "not a record");
  if (!hasRunFields(value)) return null;
  const newBlocks = value[FIELD.NEW_BLOCKS];
  if (newBlocks !== undefined && newBlocks !== null && !Array.isArray(newBlocks)) {
    return refuse("RUN_BLOCK_REFUSED", "new_blocks is not a list");
  }
  const run = listOf(newBlocks);
  const remove = listOf(value[FIELD.REMOVE_BLOCKS]);
  if (remove.length > 0 && run.length > 0) return refuse("RUN_TAKEBACK_CARRIES_RUN", "a take-back carries new_blocks");
  const placement = value[FIELD.PLACEMENT];
  if ((run.length > 0 || remove.length > 0 || placement !== undefined) && !isPlacement(placement)) {
    return refuse("RUN_PLACEMENT_REFUSED", "placement is " + JSON.stringify(placement));
  }
  const tagAfter = value[FIELD.ANCHOR_TAG_AFTER];
  if (tagAfter !== undefined && tagAfter !== null && !(typeof tagAfter === "string" && isWritableBlockTag(tagAfter))) {
    return refuse("RUN_BLOCK_REFUSED", "anchor_tag_after " + spell(tagAfter) + " is not writable");
  }
  const list = run.length > 0 ? run : remove;
  if (list.length > NEW_BLOCKS_MAX) return refuse("RUN_OVER_CEILING", String(list.length) + " blocks");
  if (blocksBytes(list) > NEW_BLOCKS_MAX_BYTES) return refuse("RUN_OVER_CEILING", "the run's markup is over the byte ceiling");
  if (recordBytes(value) > RUN_RECORD_MAX_BYTES) return refuse("RUN_OVER_CEILING", "the record is over the size ceiling");
  const parsed = parseBlocks(list);
  if ("refusal" in parsed) return refuse("RUN_BLOCK_REFUSED", parsed.refusal);
  const anchorSet = value[FIELD.ANCHOR_AFTER_HTML] !== undefined && value[FIELD.ANCHOR_AFTER_HTML] !== null;
  let problem = run.length > 0 || anchorSet ? sittingRefusal(value, parsed.blocks) : null;
  if (problem === null && remove.length > 0) problem = takeBackRefusal(value, parsed.blocks);
  return problem === null ? null : refuse("RUN_BLOCK_REFUSED", problem);
}
