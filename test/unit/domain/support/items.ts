/*
 * read-when: Writing a unit test that needs an item, a folded reply or an archived reply built the way the layer builds them.
 */

import { choiceRef, isChoiceToken } from "../../../../src/contract/choice.ts";
import type { ChoicePress } from "../../../../src/contract/choice.ts";
import { KIND, STATE, emptyRegion } from "../../../../src/contract/record.ts";
import type { ArchivedReply, FoldedReply, Item } from "../../../../src/contract/record.ts";
import { newItem } from "../../../../src/domain/item-revisions.ts";
import type { NewItemInput } from "../../../../src/domain/item-revisions.ts";

export const PAGE = {
  page_origin: "http://localhost:3000",
  page_path: "/clients",
  page_title: "Clients",
  page_seq: 1
} as const;

export const AT = "2026-08-18T12:00:00.000Z";

export function anItem(overrides: Partial<NewItemInput> = {}): Item {
  return newItem({
    kind: KIND.EDIT,
    state: STATE.READY,
    before: "old wording",
    after: "new wording",
    change: "tightened the sentence",
    ...PAGE,
    ...overrides
  });
}

export function folded(overrides: Partial<FoldedReply> = {}): FoldedReply {
  return { status: "handled", agent: "codex", reason: null, text: "Done.", files: [], at: AT, ...overrides };
}

export function archived(overrides: Partial<ArchivedReply> = {}): ArchivedReply {
  return { status: "handled", agent: "codex", reason: null, text: "Done.", files: [], at: AT, ...overrides };
}

export function literalRecord(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return { ...anItem(), ...overrides };
}

export function choicePress(group: string, answer: string): ChoicePress {
  if (!isChoiceToken(group) || !isChoiceToken(answer)) throw new Error("not choice tokens: " + group + ", " + answer);
  return { group, answer };
}

export function aChoice(overrides: Partial<NewItemInput> = {}): Item {
  return newItem({
    kind: KIND.CHOICE,
    state: STATE.READY,
    choice: choicePress("lesson-css-counter", "promote"),
    region: { ...emptyRegion(), ref: choiceRef("lesson-css-counter") },
    ...PAGE,
    ...overrides
  });
}
