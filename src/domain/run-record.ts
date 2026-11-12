/*
 * read-when: Changing how a free-writing run is recorded, viewed by replay, sized, or described to the agent.
 */

import type { Item, RunBlock } from "../contract/record.ts";

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

function notBuilt(...args: readonly unknown[]): Error {
  return new Error("C3: not built yet " + String(args.length));
}

export function buildRunAfter(anchorHtml: string | null | undefined, blocks: readonly RunBlock[] | null | undefined): RunAfter {
  throw notBuilt(anchorHtml, blocks);
}
export function anchorView(item: Item): Item {
  throw notBuilt(item);
}
export function anchorTagOf(item: Item | null | undefined): string | null {
  throw notBuilt(item);
}
export function anchorTypeOfTag(tag: string | null | undefined): AnchorTypeName {
  throw notBuilt(tag);
}
export function anchorTypeName(item: Item | null | undefined): AnchorTypeName {
  throw notBuilt(item);
}
export function recordBytes(record: object): number {
  throw notBuilt(record);
}
export function blocksBytes(blocks: readonly unknown[] | null | undefined): number {
  throw notBuilt(blocks);
}
export function handedOverBlocks(item: Item, items: readonly Item[] | null | undefined): HandedOver {
  throw notBuilt(item, items);
}
export function runChangeText(item: Item): string {
  throw notBuilt(item);
}
