/*
 * read-when: Changing the choice-button grammar, its markup names or its states, or when a choice record is refused.
 */

import type { FailureCode } from "./failures.ts";
import { isJsonObject } from "./json-object.ts";
import { FIELD, KIND, hasRunFields } from "./record.ts";

declare const choiceTokenBrand: unique symbol;
export type ChoiceToken = string & { readonly [choiceTokenBrand]: true };
export const CHOICE_TOKEN: RegExp = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
export const CHOICE_TOKEN_RULE = "1 to 64 letters, digits, hyphens, underscores, dots or colons";

export interface ChoicePress {
  readonly group: ChoiceToken;
  readonly answer: ChoiceToken;
}

export const CHOICE_MARKUP = {
  GROUP_CLASS: "choice",
  NAME_ATTR: "data-choice",
  QUESTION_CLASS: "choice-q",
  CHOSEN_ATTR: "data-chosen",
  RECOMMENDED_ATTR: "data-recommended",
  PRESSED_ATTR: "data-lahe-pressed",
  STATE_ATTR: "data-lahe-choice-state",
  INERT_ATTR: "data-lahe-inert"
} as const;

export const CHOICE_STATE = {
  KEPT: "kept",
  OPEN: "open",
  QUESTION: "question",
  NOT_HANDLED: "not_handled",
  DONE: "done"
} as const;
export type ChoiceState = (typeof CHOICE_STATE)[keyof typeof CHOICE_STATE];

export interface ChoiceRef {
  readonly kind: typeof KIND.CHOICE;
  readonly group: string;
}
export interface ChoiceRefusal {
  readonly code: Extract<FailureCode, "CHOICE_REFUSED">;
  readonly reason: string;
}

const CHOICE_KEYS: readonly string[] = ["group", "answer"];

export function isChoiceToken(value: unknown): value is ChoiceToken {
  return typeof value === "string" && CHOICE_TOKEN.test(value);
}

export function choiceRef(group: string): ChoiceRef {
  return { kind: KIND.CHOICE, group };
}

function refuse(reason: string): ChoiceRefusal {
  return { code: "CHOICE_REFUSED", reason };
}

function carriedContent(value: Readonly<Record<string, unknown>>): string[] {
  const carried: string[] = [FIELD.BEFORE, FIELD.AFTER, FIELD.BEFORE_HTML, FIELD.AFTER_HTML].filter(
    (field) => value[field] !== undefined && value[field] !== null
  );
  const history = value[FIELD.AFTER_HISTORY];
  if (Array.isArray(history) && history.length > 0) carried.push(FIELD.AFTER_HISTORY);
  if (hasRunFields(value)) carried.push("the free-writing fields");
  return carried;
}

export function validateChoice(value: unknown): ChoiceRefusal | null {
  if (!isJsonObject(value)) return refuse("not a record");
  const press = value[FIELD.CHOICE];
  const present = press !== undefined && press !== null;
  if (value[FIELD.KIND] !== KIND.CHOICE) {
    return present ? refuse("choice is set only on a choice record, and this is a " + String(value[FIELD.KIND])) : null;
  }
  if (!isJsonObject(press)) return refuse("a choice record must carry choice as {group, answer}");
  const extra = Object.keys(press).filter((key) => !CHOICE_KEYS.includes(key));
  if (extra.length > 0) return refuse("choice carries a key other than group and answer: " + extra.join(", "));
  if (!isChoiceToken(press["group"])) return refuse("choice.group is missing or off the grammar");
  if (!isChoiceToken(press["answer"])) return refuse("choice.answer is missing or off the grammar");
  const carried = carriedContent(value);
  if (carried.length > 0) return refuse("a choice record carries " + carried.join(", "));
  const region = value[FIELD.REGION];
  const ref = isJsonObject(region) ? region["ref"] : undefined;
  if (isJsonObject(ref) && typeof ref["stamp"] === "string" && ref["stamp"] !== "") return refuse("a choice record carries a stamp");
  return null;
}
