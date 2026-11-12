/*
 * read-when: The sentence an agent reads about a hand edit is wrong, misleading or missing emphasis.
 */

import type { Kind } from "../contract/record.ts";

export interface ChangedSpan {
  readonly removed: string;
  readonly added: string;
}
export interface ParagraphAddition {
  readonly where: "before" | "after";
  readonly text: string;
}
export const BREAK_ADDED_PARAGRAPH = "Added a paragraph break: this block becomes two paragraphs.";
export const BREAK_ADDED_LINE = "Added a line break.";
export const BREAK_REMOVED = "Removed a break, joining the lines into one.";

function notBuilt(...args: readonly unknown[]): Error {
  return new Error("C3: not built yet " + String(args.length));
}

export function changedSpan(before: string | null | undefined, after: string | null | undefined): ChangedSpan {
  throw notBuilt(before, after);
}
export function paragraphAddition(before: string | null | undefined, after: string | null | undefined): ParagraphAddition | null {
  throw notBuilt(before, after);
}
export function formattingChangeText(beforeHtml: string | null | undefined, afterHtml: string | null | undefined): string {
  throw notBuilt(beforeHtml, afterHtml);
}
export function editChangeText(
  kind: Kind,
  before: string | null | undefined,
  after: string | null | undefined,
  beforeHtml?: string | null,
  afterHtml?: string | null
): string {
  throw notBuilt(kind, before, after, beforeHtml, afterHtml);
}
