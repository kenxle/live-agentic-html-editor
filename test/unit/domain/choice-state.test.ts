/*
 * read-when: Changing src/domain/choice-state.ts, or a choice group on the page shows the wrong state or the wrong press, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { CHOICE_STATE } from "../../../src/contract/choice.ts";
import { KIND, STATE } from "../../../src/contract/record.ts";
import { choiceStateOf, latestChoiceByGroup } from "../../../src/domain/choice-state.ts";
import { callUntyped } from "../contract/support/untyped.ts";
import { aChoice, anItem, choicePress, folded } from "./support/items.ts";

test("a handled press is done, and a refused one is not_handled", () => {
  assert.equal(choiceStateOf(aChoice({ state: STATE.HANDLED }), false), CHOICE_STATE.DONE);
  assert.equal(choiceStateOf(aChoice({ state: STATE.HANDLED }), true), CHOICE_STATE.DONE, "a kept flag does not hide a decided press");
  assert.equal(choiceStateOf(aChoice({ state: STATE.NOT_HANDLED }), false), CHOICE_STATE.NOT_HANDLED);
  assert.equal(choiceStateOf(aChoice({ state: STATE.NOT_HANDLED }), true), CHOICE_STATE.NOT_HANDLED);
});

test("a press still in the outbox, or still a draft, shows as kept", () => {
  assert.equal(choiceStateOf(aChoice({ state: STATE.READY }), true), CHOICE_STATE.KEPT);
  assert.equal(choiceStateOf(aChoice({ state: STATE.DRAFT }), false), CHOICE_STATE.KEPT);
});

test("a press the agent asked a question about shows as question, and any other ready press is open", () => {
  assert.equal(choiceStateOf(aChoice({ reply: folded({ status: "question", text: "Sure?" }) }), false), CHOICE_STATE.QUESTION);
  assert.equal(choiceStateOf(aChoice({ reply: folded() }), false), CHOICE_STATE.OPEN);
  assert.equal(choiceStateOf(aChoice(), false), CHOICE_STATE.OPEN);
});

test("a missing record is open unless it is kept", () => {
  assert.equal(choiceStateOf(null, false), CHOICE_STATE.OPEN);
  assert.equal(choiceStateOf(undefined, false), CHOICE_STATE.OPEN);
  assert.equal(choiceStateOf(null, true), CHOICE_STATE.KEPT);
});

test("the current press for a group is the record with the latest created_at", () => {
  const first = aChoice({ id: "a", choice: choicePress("g1", "one"), created_at: "2026-01-01T00:00:00.000Z" });
  const second = aChoice({ id: "b", choice: choicePress("g1", "two"), created_at: "2026-01-02T00:00:00.000Z" });
  const other = aChoice({ id: "c", choice: choicePress("g2", "x"), created_at: "2026-01-01T12:00:00.000Z" });
  const latest = latestChoiceByGroup([second, first, other]);
  assert.equal(latest.size, 2);
  assert.equal(latest.get(choicePress("g1", "x").group)?.id, "b", "not the order of the list");
  assert.deepEqual([...latest.keys()], ["g1", "g2"]);
});

test("the current press is not the highest revision: a newer press after a handled one is a new item", () => {
  const handledPress = aChoice({ id: "old", rev: 3, state: STATE.HANDLED, choice: choicePress("g", "one"), created_at: "2026-01-01T00:00:00.000Z" });
  const newer = aChoice({ id: "new", rev: 1, choice: choicePress("g", "two"), created_at: "2026-01-02T00:00:00.000Z" });
  const got = [...latestChoiceByGroup([handledPress, newer]).values()];
  assert.deepEqual(got.map((item) => item.id), ["new"]);
});

test("a later item in the list wins a tie", () => {
  const a = aChoice({ id: "a", choice: choicePress("g", "one"), created_at: "2026-01-01T00:00:00.000Z" });
  const b = aChoice({ id: "b", choice: choicePress("g", "two"), created_at: "2026-01-01T00:00:00.000Z" });
  assert.deepEqual([...latestChoiceByGroup([a, b]).values()].map((item) => item.id), ["b"]);
  assert.deepEqual([...latestChoiceByGroup([b, a]).values()].map((item) => item.id), ["a"]);
});

test("records of other kinds, and choice records off the grammar, are left out", () => {
  const comment = anItem({ kind: KIND.COMMENT, note: "x" });
  const offGrammar = { ...aChoice({ id: "bad" }), choice: { group: "has space", answer: "x" } };
  const noChoice = { ...aChoice({ id: "none" }), choice: undefined };
  const good = aChoice({ id: "good" });
  const got = callUntyped(latestChoiceByGroup, [comment, offGrammar, noChoice, good]);
  assert.ok(got instanceof Map);
  assert.deepEqual([...got.keys()], ["lesson-css-counter"]);
});

test("a group named constructor or toString is an ordinary key", () => {
  const a = aChoice({ id: "a", choice: choicePress("constructor", "x"), created_at: "2026-01-01T00:00:00.000Z" });
  const b = aChoice({ id: "b", choice: choicePress("toString", "y"), created_at: "2026-01-01T00:00:00.000Z" });
  const latest = latestChoiceByGroup([a, b]);
  assert.deepEqual([...latest.keys()], ["constructor", "toString"]);
  assert.equal(latest.size, 2);
  assert.equal(latestChoiceByGroup([]).size, 0);
});

test("no list is no groups", () => {
  assert.equal(latestChoiceByGroup(null).size, 0);
  assert.equal(latestChoiceByGroup(undefined).size, 0);
  assert.equal(latestChoiceByGroup([]).size, 0);
});
