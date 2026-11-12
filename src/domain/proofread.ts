/*
 * read-when: The reviewer's "Use the fixes" changes the wrong words, loses formatting, or is refused.
 */

import type { FailureCode } from "../contract/failures.ts";
import { isJsonObject } from "../contract/json-object.ts";
import { isRunRecord } from "../contract/record.ts";
import type { Item, RunBlock } from "../contract/record.ts";
import { bumpRev } from "./item-revisions.ts";
import { buildRunAfter } from "./run-record.ts";
import { cleanBlock } from "./run-blocks.ts";

export const USE_FIXES_CHANGE =
  "The reviewer took your proofreading fixes, {n} in all. In the source, replace each fix's from words with its to words in the block you already placed, in place, so it matches new_blocks; do not add any block again. The fixes are listed as block, from and to under suggestions in the thread's last agent turn.";

export interface SuggestionRefusal {
  readonly code: Extract<FailureCode, "SUGGESTION_NOT_FOUND">;
  readonly reason: string;
}

interface TextPiece {
  readonly index: number;
  readonly start: number;
  readonly text: string;
}

const TAG_SEGMENT = /^<\/?[a-z-]+>$/;

function decodeBasic(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function encodeBasic(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function rewordBlock(html: string, from: string, replacement: string): string | null {
  const parts = html.split(/(<\/?[a-z-]+>)/).filter((part) => part !== "");
  const pieces: TextPiece[] = [];
  let joined = "";
  parts.forEach((part, index) => {
    if (TAG_SEGMENT.test(part)) return;
    const text = decodeBasic(part);
    pieces.push({ index, start: joined.length, text });
    joined += text;
  });
  const found = joined.indexOf(from);
  if (found === -1 || joined.indexOf(from, found + 1) !== -1) return null;
  let pre = 0;
  while (pre < from.length && pre < replacement.length && from.charAt(pre) === replacement.charAt(pre)) pre += 1;
  let post = 0;
  while (
    post < from.length - pre &&
    post < replacement.length - pre &&
    from.charAt(from.length - 1 - post) === replacement.charAt(replacement.length - 1 - post)
  ) {
    post += 1;
  }
  const first = found + pre;
  const end = found + from.length - post;
  const to = replacement.slice(pre, replacement.length - post);
  if (first === end) {
    const piece = pieces.find((one) => first >= one.start && first <= one.start + one.text.length);
    if (piece === undefined) return null;
    const at = first - piece.start;
    parts[piece.index] = encodeBasic(piece.text.slice(0, at) + to + piece.text.slice(at));
    return parts.join("");
  }
  let placed = false;
  for (const piece of pieces) {
    const pieceEnd = piece.start + piece.text.length;
    if (pieceEnd <= first || piece.start >= end) continue;
    const cutStart = Math.max(first, piece.start) - piece.start;
    const cutEnd = Math.min(end, pieceEnd) - piece.start;
    const insert = placed ? "" : to;
    placed = true;
    parts[piece.index] = encodeBasic(piece.text.slice(0, cutStart) + insert + piece.text.slice(cutEnd));
  }
  return parts.join("");
}

function notFound(reason: string): SuggestionRefusal {
  return { code: "SUGGESTION_NOT_FOUND", reason };
}

export function applySuggestions(item: Item, suggestions: readonly unknown[] | null | undefined): Item | SuggestionRefusal {
  if (!isRunRecord(item)) return notFound("not a run record");
  const blocks: RunBlock[] = (item.new_blocks ?? []).map((block) => ({ ...block }));
  const list: readonly unknown[] = Array.isArray(suggestions) ? suggestions : [];
  for (const [i, raw] of list.entries()) {
    const suggestion = isJsonObject(raw) ? raw : {};
    const at = "suggestion " + String(i);
    const index = suggestion["block"];
    const from = suggestion["from"];
    const to = suggestion["to"];
    const block = typeof index === "number" ? blocks[index] : undefined;
    if (block === undefined || typeof index !== "number" || typeof from !== "string" || from === "" || typeof to !== "string") {
      return notFound(at + " does not name a block and a from");
    }
    if (block.from_anchor === true) return notFound(at + ": block " + String(index) + " is marked from_anchor, the page's own words");
    const reworded = rewordBlock(block.html, from, to);
    if (reworded === null) return notFound(at + ": from is not in block " + String(index) + " exactly once");
    const cleaned = cleanBlock(block.tag, reworded);
    if (!("html" in cleaned)) return notFound(at + " leaves block " + String(index) + " empty or unsafe");
    blocks[index] = { ...block, html: cleaned.html };
  }
  const built = buildRunAfter(item.anchor_after_html, blocks);
  return bumpRev(item, {
    change: USE_FIXES_CHANGE.replace("{n}", String(list.length)),
    new_blocks: blocks,
    after_html: built.after_html,
    after: built.after
  });
}
