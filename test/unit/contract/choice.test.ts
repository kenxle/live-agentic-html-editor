/*
 * read-when: Changing src/contract/choice.ts, the choice-button grammar, its markup names or its states, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHOICE_MARKUP,
  CHOICE_STATE,
  CHOICE_TOKEN,
  CHOICE_TOKEN_RULE,
  choiceRef,
  isChoiceToken,
  validateChoice
} from "../../../src/contract/choice.ts";
import { CODES } from "../../../src/contract/failures.ts";
import { KIND, emptyRegion } from "../../../src/contract/record.ts";
import { bumpRev } from "../../../src/domain/item-revisions.ts";
import { followUp } from "../../../src/domain/thread.ts";
import { aChoice, anItem, choicePress, folded } from "../domain/support/items.ts";
import { label } from "./support/untyped.ts";

function refusal(reason: string): unknown {
  return { code: "CHOICE_REFUSED", reason };
}

test("the grammar takes one to sixty-four letters, digits, hyphens, underscores, dots or colons, starting with a letter or digit", () => {
  for (const value of ["A_jev", "optionB", "v1.2", "Closest_21", "a", "9", "step:3", "lesson-css-counter", "a".repeat(64)]) {
    assert.equal(isChoiceToken(value), true, value);
  }
  for (const value of ["", "a".repeat(65), "-a", "_a", ".a", ":a", "has space", "<b>", 'a"b', "a'b", "a`b", "a[b]", "a/b", "a\\b", "a\nb"]) {
    assert.equal(isChoiceToken(value), false, JSON.stringify(value));
  }
  for (const value of [null, undefined, 3, {}, ["a"], true]) assert.equal(isChoiceToken(value), false, label(value));
});

test("the grammar is the regular expression the rail and the helper read, and it has a sentence for the refusal chip", () => {
  assert.equal(String(CHOICE_TOKEN), "/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/");
  assert.equal(CHOICE_TOKEN_RULE, "1 to 64 letters, digits, hyphens, underscores, dots or colons");
});

test("the choice markup names are spelled once, as these eight", () => {
  assert.deepEqual(CHOICE_MARKUP, {
    GROUP_CLASS: "choice",
    NAME_ATTR: "data-choice",
    QUESTION_CLASS: "choice-q",
    CHOSEN_ATTR: "data-chosen",
    RECOMMENDED_ATTR: "data-recommended",
    PRESSED_ATTR: "data-lahe-pressed",
    STATE_ATTR: "data-lahe-choice-state",
    INERT_ATTR: "data-lahe-inert"
  });
});

test("the choice states are the rail's five words for a group", () => {
  assert.deepEqual(CHOICE_STATE, { KEPT: "kept", OPEN: "open", QUESTION: "question", NOT_HANDLED: "not_handled", DONE: "done" });
});

test("a choice reference names its kind and its group and nothing else", () => {
  const ref = choiceRef("lesson-css-counter");
  assert.deepEqual(ref, { kind: "choice", group: "lesson-css-counter" });
  assert.deepEqual(Object.keys(ref), ["kind", "group"]);
});

test("a valid choice record passes, and so does the same record reworded and followed up", () => {
  const item = aChoice();
  assert.deepEqual(item.choice, { group: "lesson-css-counter", answer: "promote" });
  assert.equal(validateChoice(item), null);
  const reworded = bumpRev(item, { choice: choicePress("lesson-css-counter", "defer") });
  assert.equal(reworded.rev, 2);
  assert.equal(validateChoice(reworded), null);
  const answered = { ...reworded, reply: folded() };
  const again = followUp(answered, "Actually, hold off.");
  assert.equal(again.rev, 3);
  assert.deepEqual(again.choice, { group: "lesson-css-counter", answer: "defer" }, "a follow-up keeps the press");
  assert.equal(validateChoice(again), null);
});

test("a record that is not a choice has no choice, and no other record is refused for lacking one", () => {
  const comment = anItem({ kind: KIND.COMMENT, note: "x" });
  assert.equal(Object.hasOwn(comment, "choice"), false, "today's records are unchanged");
  assert.equal(validateChoice(comment), null);
  assert.equal(validateChoice({ ...comment, choice: null }), null);
});

test("validateChoice refuses a value that is not a record, and never throws", () => {
  for (const value of [null, undefined, "x", 3, true]) {
    assert.deepEqual(validateChoice(value), refusal("not a record"), label(value));
  }
});

test("a choice set on a record that is not a choice is refused, naming the kind", () => {
  const base = aChoice();
  assert.deepEqual(
    validateChoice({ ...base, kind: KIND.COMMENT }),
    refusal("choice is set only on a choice record, and this is a comment")
  );
  assert.deepEqual(
    validateChoice({ ...base, kind: "nonsense" }),
    refusal("choice is set only on a choice record, and this is a nonsense")
  );
});

test("a choice record must carry choice as an object with a group and an answer", () => {
  const base = aChoice();
  const need = "a choice record must carry choice as {group, answer}";
  const missing: Record<string, unknown> = { ...base };
  delete missing["choice"];
  assert.deepEqual(validateChoice(missing), refusal(need));
  for (const choice of [null, "x", 3, ["a", "b"]]) {
    assert.deepEqual(validateChoice({ ...base, choice }), refusal(need), label(choice));
  }
});

test("a choice carrying any key beyond group and answer is refused, naming the keys", () => {
  const base = aChoice();
  assert.deepEqual(
    validateChoice({ ...base, choice: { group: "g", answer: "a", label: "Promote", extra: 1 } }),
    refusal("choice carries a key other than group and answer: label, extra")
  );
});

test("the group and the answer are each held to the grammar, group first", () => {
  const base = aChoice();
  assert.deepEqual(validateChoice({ ...base, choice: { answer: "promote" } }), refusal("choice.group is missing or off the grammar"));
  assert.deepEqual(
    validateChoice({ ...base, choice: { group: "has space", answer: "also bad" } }),
    refusal("choice.group is missing or off the grammar")
  );
  assert.deepEqual(
    validateChoice({ ...base, choice: { group: "lesson", answer: "Promote it, and also rewrite the intro" } }),
    refusal("choice.answer is missing or off the grammar")
  );
});

test("a choice record carries no before, after, markup, history or free-writing fields, and names what it carries", () => {
  const base = aChoice();
  assert.deepEqual(validateChoice({ ...base, before: "Promote this lesson?" }), refusal("a choice record carries before"));
  assert.deepEqual(validateChoice({ ...base, after: "anything" }), refusal("a choice record carries after"));
  assert.deepEqual(validateChoice({ ...base, after_html: "<b>x</b>" }), refusal("a choice record carries after_html"));
  assert.deepEqual(
    validateChoice({ ...base, before: "a", after: "b", before_html: "c", after_html: "d" }),
    refusal("a choice record carries before, after, before_html, after_html")
  );
  assert.deepEqual(validateChoice({ ...base, before: null, after: null }), null, "a null is not carried");
  assert.deepEqual(
    validateChoice({ ...base, after_history: [{ rev: 1, after: "x", after_html: null, at: "t" }] }),
    refusal("a choice record carries after_history")
  );
  assert.equal(validateChoice({ ...base, after_history: [] }), null, "an empty history is not carried");
  assert.deepEqual(
    validateChoice({ ...base, new_blocks: [{ tag: "p", html: "x" }], placement: "after_anchor" }),
    refusal("a choice record carries the free-writing fields")
  );
  assert.deepEqual(
    validateChoice({ ...base, before: "a", after_history: [{ rev: 1 }], placement: "after_anchor" }),
    refusal("a choice record carries before, after_history, the free-writing fields")
  );
});

test("a choice record carries no stamp", () => {
  const base = aChoice();
  const stamped = { ...base, region: { ...emptyRegion(), ref: { kind: "choice", group: "lesson-css-counter", stamp: "lahe-abc" } } };
  assert.deepEqual(validateChoice(stamped), refusal("a choice record carries a stamp"));
  const unstamped = { ...base, region: { ...emptyRegion(), ref: { kind: "choice", group: "lesson-css-counter", stamp: "" } } };
  assert.equal(validateChoice(unstamped), null);
});

test("the refusals come in the documented order, so the first problem is the one named", () => {
  const base = aChoice();
  const both = { ...base, choice: { group: "bad group", answer: "bad answer", extra: 1 }, before: "x" };
  assert.deepEqual(validateChoice(both), refusal("choice carries a key other than group and answer: extra"));
  const bothTokens = { ...base, choice: { group: "bad group", answer: "bad answer" }, before: "x" };
  assert.deepEqual(validateChoice(bothTokens), refusal("choice.group is missing or off the grammar"));
});

test("the refusal's code is in the failure table", () => {
  assert.equal(Object.hasOwn(CODES, "CHOICE_REFUSED"), true);
});
