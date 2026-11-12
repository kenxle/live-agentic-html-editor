/*
 * read-when: Changing the allowlist a free-written block passes, or how a run's words are read.
 */

import type { FailureCode } from "../contract/failures.ts";
import type { ResetTag } from "./formatting.ts";

const NOT_BUILT = "C2: not built yet";

export const WRITABLE_BLOCK_TAGS: readonly ["p", "h2", "h3", "h4", "ul", "ol"] = ["p", "h2", "h3", "h4", "ul", "ol"];
export type WritableBlockTag = (typeof WRITABLE_BLOCK_TAGS)[number];
export function isWritableBlockTag(name: string): name is WritableBlockTag {
  throw new Error(NOT_BUILT + name);
}

export type InlineTag = "strong" | "em" | ResetTag;
export function inlineTagFor(name: string): InlineTag | null {
  throw new Error(NOT_BUILT + name);
}

export const MAX_BLOCK_NESTING = 32;

export interface CleanedBlock {
  readonly html: string;
}
export interface BlockRefusal {
  readonly code: Extract<FailureCode, "RUN_BLOCK_REFUSED">;
  readonly reason: string;
}
export function cleanBlock(tag: unknown, html: unknown): CleanedBlock | BlockRefusal {
  throw new Error(NOT_BUILT + String(tag) + String(html));
}

declare const blockWordsBrand: unique symbol;
export type BlockWords = string & { readonly [blockWordsBrand]: true };
export function blockWords(html: string | null | undefined): BlockWords {
  throw new Error(NOT_BUILT + String(html));
}

export interface RunWordsBlock {
  readonly html: string;
  readonly from_anchor?: boolean;
}
export function runWords(blocks: readonly RunWordsBlock[] | undefined): number {
  throw new Error(NOT_BUILT + String(blocks?.length));
}
