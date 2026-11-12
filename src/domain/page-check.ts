/*
 * read-when: The page check reopens an item, its sentence repeats in a note, or a reviewer sees tool text on their card.
 */

import { isJsonObject } from "../contract/json-object.ts";
import { emptyRegion, isToolRoundName } from "../contract/record.ts";
import type { CheckReopen, Item, ToolRoundName } from "../contract/record.ts";
import { nowIso } from "./mint.ts";
import { replyStamp } from "./reply-unread.ts";
import { reopenIssue } from "./thread.ts";

export const PAGE_CHECK_STAMP_NOTE =
  "Reopened by the page check: the change landed but the data-lahe-id stamp did not reach the source. Write the stamp onto that element so the next build reproduces it, or reply not_handled saying why.";
export const LEGACY_PAGE_CHECK_NOTE =
  "Reopened by the page check: this handled change is no longer on the page and the original text is back. Reapply it, or reply not_handled saying why.";
export const PAGE_CHECK_NOTES: readonly [typeof PAGE_CHECK_STAMP_NOTE, typeof LEGACY_PAGE_CHECK_NOTE] = [
  PAGE_CHECK_STAMP_NOTE,
  LEGACY_PAGE_CHECK_NOTE
];

export function appendNoteOnce(carried: string | null | undefined, sentence: string): string | null {
  if (sentence.trim() === "") return typeof carried === "string" ? carried : null;
  const note = typeof carried === "string" ? carried : "";
  if (note.trim() === "") return sentence;
  if (note.includes(sentence)) return note;
  return note + "\n\n" + sentence;
}

export function stampPageCheckReopen(
  item: Item | null | undefined,
  stamp: string | null,
  at?: string | null,
  tool?: ToolRoundName | null
): CheckReopen | null {
  if (!item) return null;
  const region = isJsonObject(item.region) ? item.region : emptyRegion();
  const checkReopen: CheckReopen = {
    rev: item.rev,
    at: at || nowIso(),
    stamp: typeof stamp === "string" ? stamp : null,
    tool: isToolRoundName(tool) ? tool : null
  };
  item.region = { ...region, check_reopen: checkReopen };
  return checkReopen;
}

export function pageCheckReopenOf(item: Item, note: string, at?: string | null, tool?: ToolRoundName | null): Item {
  const stamp = replyStamp(item);
  const next = reopenIssue(item);
  if (note.trim() !== "") next.note = appendNoteOnce(next.note, note);
  stampPageCheckReopen(next, stamp, at, tool);
  return next;
}

function collapseSentence(note: string, sentence: string): string {
  const first = note.indexOf(sentence);
  if (first === -1) return note;
  const afterFirst = first + sentence.length;
  if (note.indexOf(sentence, afterFirst) === -1) return note;
  const head = note.slice(0, afterFirst);
  const tail = note
    .slice(afterFirst)
    .split(sentence)
    .join("")
    .replace(/^(\s*\n)+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return tail === "" ? head : head + "\n\n" + tail;
}

export function collapsePageCheckNote<T>(value: T): T {
  if (!isJsonObject(value)) return value;
  const note = value["note"];
  if (typeof note !== "string") return value;
  const collapsed = PAGE_CHECK_NOTES.reduce((text, sentence) => collapseSentence(text, sentence), note);
  return collapsed === note ? value : { ...value, note: collapsed };
}

export function reviewerNote(item: Pick<Item, "note"> | null | undefined): string | null {
  const note = item?.note;
  if (typeof note !== "string" || note === "") return null;
  const out = note.split(PAGE_CHECK_STAMP_NOTE).join("").replace(/\n{3,}/g, "\n\n").trim();
  return out === "" ? null : out;
}
