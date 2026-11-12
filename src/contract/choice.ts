/*
 * read-when: Changing the choice-button grammar, its markup names or its states, or when a choice record is refused.
 */

import type { FailureCode } from "./failures.ts";
import { KIND } from "./record.ts";

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

function notBuilt(...args: readonly unknown[]): Error {
  return new Error("C3: not built yet " + String(args.length));
}

export function isChoiceToken(value: unknown): value is ChoiceToken {
  throw notBuilt(value);
}
export function choiceRef(group: string): ChoiceRef {
  throw notBuilt(group);
}
export function validateChoice(value: unknown): ChoiceRefusal | null {
  throw notBuilt(value);
}
