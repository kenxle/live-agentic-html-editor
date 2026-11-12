/*
 * read-when: Changing how a free-writing run is recorded, viewed by replay, sized, or described to the agent.
 */

import { isJsonObject } from "../contract/json-object.ts";
import { PLACEMENT, isHandEdit, isRevert } from "../contract/record.ts";
import type { Item, RunBlock } from "../contract/record.ts";
import { utf8ByteLength } from "../contract/utf8.ts";
import { blockText, textOf } from "./block-text.ts";
import { emphasisRuns } from "./comparison.ts";
import { blockWords } from "./run-blocks.ts";
import { normalizeText } from "./text.ts";

export interface RunAfter {
  readonly after_html: string;
  readonly after: string;
}
export type AnchorTypeName = "paragraph" | "heading" | "list" | "block";
export interface HandedBlock {
  readonly id: string;
  readonly tag: string | null;
  readonly html: string | null;
}
export interface HandedOver {
  readonly [index: number]: HandedBlock | undefined;
  readonly anchor?: HandedBlock;
}

const TYPE_NAMES: Readonly<Record<string, AnchorTypeName>> = {
  p: "paragraph",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  ul: "list",
  ol: "list"
};

export function buildRunAfter(anchorHtml: string | null | undefined, blocks: readonly RunBlock[] | null | undefined): RunAfter {
  let html = typeof anchorHtml === "string" ? anchorHtml : "";
  for (const block of blocks ?? []) html += "<" + block.tag + ">" + block.html + "</" + block.tag + ">";
  return { after_html: html, after: blockText(html) };
}

export function anchorView(item: Item): Item {
  if (!isJsonObject(item) || typeof item.anchor_after_html !== "string") return item;
  return { ...item, after_html: item.anchor_after_html, after: blockText(item.anchor_after_html) };
}

export function anchorTagOf(item: Item | null | undefined): string | null {
  const tag = item?.region.ref?.fingerprint?.tag;
  if (typeof tag === "string" && tag !== "") return tag.toLowerCase();
  const element = item?.context.element;
  return typeof element === "string" && element !== "" ? element.toLowerCase() : null;
}

export function anchorTypeOfTag(tag: string | null | undefined): AnchorTypeName {
  return typeof tag === "string" && Object.hasOwn(TYPE_NAMES, tag) ? (TYPE_NAMES[tag] ?? "block") : "block";
}

export function anchorTypeName(item: Item | null | undefined): AnchorTypeName {
  return anchorTypeOfTag(anchorTagOf(item));
}

export function recordBytes(record: object): number {
  return utf8ByteLength(JSON.stringify(record));
}

export function blocksBytes(blocks: readonly unknown[] | null | undefined): number {
  const list: readonly unknown[] = Array.isArray(blocks) ? blocks : [];
  let total = 0;
  for (const block of list) {
    if (isJsonObject(block) && typeof block["html"] === "string") total += utf8ByteLength(block["html"]);
  }
  return total;
}

function placementIsStart(item: Item): boolean {
  return item.placement === PLACEMENT.START_OF_CONTAINER;
}

export function handedOverBlocks(item: Item, items: readonly Item[] | null | undefined): HandedOver {
  const out: { [index: number]: HandedBlock | undefined; anchor?: HandedBlock } = {};
  const list = items ?? [];
  if (list.length === 0) return out;
  const keys = (item.new_blocks ?? []).map((block) => (typeof block.html === "string" ? blockWords(block.html) : ""));
  const anchorKey =
    typeof item.anchor_after_html === "string" && !placementIsStart(item) ? blockWords(item.anchor_after_html) : "";
  for (const other of list) {
    if (other === item || other.id === item.id) continue;
    if (!isHandEdit(other) || isRevert(other)) continue;
    if (typeof other.created_at === "string" && typeof item.created_at === "string" && other.created_at < item.created_at) continue;
    const before = typeof other.before_html === "string" ? other.before_html : other.before;
    const key = typeof before === "string" ? blockWords(before) : "";
    if (key === "") continue;
    const html = typeof other.anchor_after_html === "string" ? other.anchor_after_html : other.after_html;
    const taken: HandedBlock = {
      id: other.id,
      tag: typeof other.anchor_tag_after === "string" && other.anchor_tag_after !== "" ? other.anchor_tag_after : null,
      html: typeof html === "string" ? html : null
    };
    keys.forEach((one, index) => {
      if (one !== "" && one === key && !out[index]) out[index] = taken;
    });
    if (anchorKey !== "" && anchorKey === key && !out.anchor) out.anchor = taken;
  }
  return out;
}

function wordsKey(html: string): string {
  return normalizeText(textOf(html));
}

function emphasisKey(html: string): string {
  return JSON.stringify(emphasisRuns(html));
}

export function runChangeText(item: Item): string {
  const type = anchorTypeName(item);
  const container = placementIsStart(item);
  const blocks = item.new_blocks ?? [];
  const lines: string[] = [];
  const tailIndex = blocks.findIndex((block) => block.from_anchor === true);
  if (!container && typeof item.anchor_after_html === "string") {
    const tails = blocks.filter((block) => block.from_anchor === true).map((block) => block.html);
    const afterAnchor = [item.anchor_after_html, ...tails].join(" ");
    const before = typeof item.before_html === "string" ? item.before_html : (item.before ?? "");
    if (wordsKey(afterAnchor) !== wordsKey(before) || emphasisKey(afterAnchor) !== emphasisKey(before)) {
      lines.push("Reworded this " + type + "; its new markup is in anchor_after_html.");
    }
  }
  const newTag = item.anchor_tag_after;
  if (!container && typeof newTag === "string" && newTag !== "") lines.push("Changed this " + type + " to " + newTag + ".");
  if (tailIndex !== -1) {
    lines.push(
      "Split this " + type + " in two after the anchor's new end. The second part is new_blocks[" + String(tailIndex) + "], marked from_anchor."
    );
  }
  const added = blocks.filter((block) => block.from_anchor !== true);
  if (added.length > 0) {
    const where = container ? "at the start of the page" : "after this " + type;
    const tags = added.map((block) => block.tag).join(", ");
    const single = added.length === 1;
    lines.push(
      "Added " + String(added.length) + (single ? " block " : " blocks ") + where + ": " + tags + ". " + (single ? "Its words are" : "Their words are") + " in new_blocks."
    );
  }
  return lines.join(" ") || "Edited this " + type + ".";
}
