/*
 * read-when: Changing how a run's blocks are matched against the page's leaf blocks, or how a clash is found.
 */

import type { BlockTag } from "./html-syntax.ts";
import type { BlockWords } from "./run-blocks.ts";

const NOT_BUILT = "C2: not built yet";

export const SHORT_BLOCK_WORDS = 5;
export const RUN_WALK_SLACK = 2;

export interface LeafBlock {
  readonly tag: BlockTag;
  readonly html: string;
  readonly words: BlockWords;
}
export function leafBlocks(html: string): readonly LeafBlock[] {
  throw new Error(NOT_BUILT + html);
}

export type MatchEntry = { readonly words: BlockWords } | { readonly html: string };

export const MATCH_STATUS: {
  readonly WHOLE: "whole";
  readonly JOINED: "joined";
  readonly SPLIT: "split";
  readonly MISSING: "missing";
} = { WHOLE: "whole", JOINED: "joined", SPLIT: "split", MISSING: "missing" };
export type MatchStatus = (typeof MATCH_STATUS)[keyof typeof MATCH_STATUS];
export type BlockMatch =
  | { readonly index: number; readonly status: "missing"; readonly leaves: readonly [] }
  | {
      readonly index: number;
      readonly status: "whole" | "joined" | "split";
      readonly leaves: readonly [number, ...number[]];
    };
export function matchRun(blocks: readonly MatchEntry[], leaves: readonly MatchEntry[]): readonly BlockMatch[] {
  throw new Error(NOT_BUILT + String(blocks.length) + String(leaves.length));
}

export interface RunClash {
  readonly index: number;
  readonly blocks: number;
  readonly leaf: number;
}
export function runClash(blocks: readonly MatchEntry[], leaves: readonly MatchEntry[]): RunClash | null {
  throw new Error(NOT_BUILT + String(blocks.length) + String(leaves.length));
}
