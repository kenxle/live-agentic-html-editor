/*
 * read-when: The sentence an agent reads about a hand edit is wrong, misleading or missing emphasis.
 */

import { KIND } from "../contract/record.ts";
import type { Kind } from "../contract/record.ts";
import { emphasisRuns } from "./comparison.ts";
import type { EmphasisRun } from "./comparison.ts";
import { RESET_TAGS } from "./formatting.ts";
import type { StructuralTag } from "./formatting.ts";

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

const WORD_CHAR = /[A-Za-z0-9_\u00C0-\u024F\u0370-\u1FFF\u2C00-\uD7FF'\u2019]/;
const PARAGRAPH_BREAK_HEAD = /^\n{2,}/;
const PARAGRAPH_BREAK_TAIL = /\n{2,}$/;
const QUOTE_LEAD_MAX = 60;

interface Emphasis {
  readonly word: "bold" | "italic";
  readonly added: boolean;
}

const EMPHASIS: { readonly [Tag in StructuralTag]: Emphasis } = {
  strong: { word: "bold", added: true },
  em: { word: "italic", added: true },
  "not-bold": { word: "bold", added: false },
  "not-italic": { word: "italic", added: false }
};

function isWordChar(character: string): boolean {
  return character !== "" && WORD_CHAR.test(character);
}

export function changedSpan(before: string | null | undefined, after: string | null | undefined): ChangedSpan {
  const b = typeof before === "string" ? before : "";
  const a = typeof after === "string" ? after : "";
  let start = 0;
  const maxStart = Math.min(b.length, a.length);
  while (start < maxStart && b.charAt(start) === a.charAt(start)) start += 1;
  while (start > 0 && isWordChar(b.charAt(start - 1)) && (isWordChar(b.charAt(start)) || isWordChar(a.charAt(start)))) {
    start -= 1;
  }
  let endB = b.length;
  let endA = a.length;
  while (endB > start && endA > start && b.charAt(endB - 1) === a.charAt(endA - 1)) {
    endB -= 1;
    endA -= 1;
  }
  while (
    endB < b.length &&
    endA < a.length &&
    isWordChar(b.charAt(endB)) &&
    (isWordChar(b.charAt(endB - 1)) || isWordChar(a.charAt(endA - 1)))
  ) {
    endB += 1;
    endA += 1;
  }
  return { removed: b.slice(start, endB), added: a.slice(start, endA) };
}

export function paragraphAddition(before: string | null | undefined, after: string | null | undefined): ParagraphAddition | null {
  const b = typeof before === "string" ? before.trim() : "";
  const a = typeof after === "string" ? after.trim() : "";
  if (b === "" || a === "" || a === b || a.length <= b.length) return null;
  if (a.startsWith(b)) {
    const tail = a.slice(b.length);
    const head = PARAGRAPH_BREAK_HEAD.exec(tail);
    if (head) {
      const below = tail.slice(head[0].length).trim();
      if (below !== "") return { where: "after", text: below };
    }
  }
  if (a.endsWith(b)) {
    const lead = a.slice(0, a.length - b.length);
    const joint = PARAGRAPH_BREAK_TAIL.exec(lead);
    if (joint) {
      const above = lead.slice(0, lead.length - joint[0].length).trim();
      if (above !== "") return { where: "before", text: above };
    }
  }
  return null;
}

function quoteLead(text: string): string {
  const folded = text.replace(/\s+/g, " ").trim();
  if (folded.length <= QUOTE_LEAD_MAX) return folded;
  let cut = folded.slice(0, QUOTE_LEAD_MAX);
  const space = cut.lastIndexOf(" ");
  if (space > QUOTE_LEAD_MAX / 3) cut = cut.slice(0, space);
  return cut + "...";
}

function breakSentence(span: ChangedSpan): string {
  if (span.added.includes("\n")) return span.added.includes("\n\n") ? BREAK_ADDED_PARAGRAPH : BREAK_ADDED_LINE;
  return span.removed.includes("\n") ? BREAK_REMOVED : "";
}

type RunCounts = Map<StructuralTag, Map<string, number>>;

function countRuns(runs: readonly EmphasisRun[]): RunCounts {
  const counts: RunCounts = new Map();
  for (const run of runs) {
    const byText = counts.get(run.tag) ?? new Map<string, number>();
    byText.set(run.text, (byText.get(run.text) ?? 0) + 1);
    counts.set(run.tag, byText);
  }
  return counts;
}

function takeOne(counts: RunCounts, tag: StructuralTag, text: string): boolean {
  const byText = counts.get(tag);
  const left = byText?.get(text) ?? 0;
  if (byText === undefined || left === 0) return false;
  byText.set(text, left - 1);
  return true;
}

export function formattingChangeText(beforeHtml: string | null | undefined, afterHtml: string | null | undefined): string {
  if (typeof afterHtml !== "string" || afterHtml === "") return "";
  const before = emphasisRuns(typeof beforeHtml === "string" ? beforeHtml : "");
  const after = emphasisRuns(afterHtml);
  const beforeLeft = countRuns(before);
  const afterLeft = countRuns(after);
  const resets = countRuns(after);
  const sentences: string[] = [];
  for (const run of after) {
    if (takeOne(beforeLeft, run.tag, run.text)) continue;
    const emphasis = EMPHASIS[run.tag];
    sentences.push(emphasis.added ? 'Made "' + run.text + '" ' + emphasis.word + "." : "Removed " + emphasis.word + ' from "' + run.text + '".');
  }
  for (const run of before) {
    if (takeOne(afterLeft, run.tag, run.text)) continue;
    const emphasis = EMPHASIS[run.tag];
    if (!emphasis.added) continue;
    if (takeOne(resets, RESET_TAGS[emphasis.word], run.text)) continue;
    sentences.push("Removed " + emphasis.word + ' from "' + run.text + '".');
  }
  return sentences.join(" ");
}

export function editChangeText(
  kind: Kind,
  before: string | null | undefined,
  after: string | null | undefined,
  beforeHtml?: string | null,
  afterHtml?: string | null
): string {
  if (kind === KIND.DELETE) return "Deleted this block.";
  if (kind === KIND.FORMAT_ONLY) return "Changed the emphasis in this block; the words are the same.";
  const emphasis = formattingChangeText(beforeHtml, afterHtml);
  const addition = paragraphAddition(before, after);
  if (addition) {
    const sentence = "Added a paragraph " + addition.where + ' "' + quoteLead(before ?? "") + '": "' + addition.text + '".';
    return emphasis === "" ? sentence : sentence + " " + emphasis;
  }
  const span = changedSpan(before, after);
  const breakLine = breakSentence(span);
  const fold = (text: string): string => (breakLine === "" ? text : text.replace(/\s+/g, " ").trim());
  const added = fold(span.added);
  const removed = fold(span.removed);
  let words = "";
  if (added !== "" && removed !== "") words = 'Changed "' + removed + '" to "' + added + '".';
  else if (added !== "") words = 'Added "' + added + '".';
  else if (removed !== "") words = 'Removed "' + removed + '".';
  const parts = [breakLine, words, emphasis].filter((part) => part !== "");
  return parts.length > 0 ? parts.join(" ") : "Edited this block.";
}
