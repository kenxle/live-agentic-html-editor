/*
 * read-when: Changing src/domain/item-status.ts, or a count, a list or a badge disagrees with another about which items are waiting, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { STATE } from "../../../src/contract/record.ts";
import type { ItemState } from "../../../src/contract/record.ts";
import {
  isClosedByReviewer,
  isDraft,
  isOutstanding,
  isReady,
  isReplayable,
  isUnansweredReady
} from "../../../src/domain/item-status.ts";
import { stampPageCheckReopen } from "../../../src/domain/page-check.ts";
import { TOOL_ROUND } from "../../../src/contract/record.ts";
import { anItem, folded } from "./support/items.ts";

const STATES: readonly ItemState[] = [STATE.DRAFT, STATE.READY, STATE.HANDLED, STATE.NOT_HANDLED];

function inState(state: ItemState): { readonly state: ItemState } {
  return { state };
}

test("draft and ready are those states exactly", () => {
  for (const state of STATES) {
    assert.equal(isDraft(inState(state)), state === STATE.DRAFT, state);
    assert.equal(isReady(inState(state)), state === STATE.READY, state);
  }
});

test("a ready record with no reply is unanswered, and so is a ready one whose handled claim the page did not bear out", () => {
  assert.equal(isUnansweredReady(anItem({ state: STATE.READY })), true);
  assert.equal(isUnansweredReady(anItem({ state: STATE.READY, reply: folded() })), false);
  assert.equal(isUnansweredReady(anItem({ state: STATE.READY, reply: folded(), handled_not_on_page: true })), true);
  assert.equal(isUnansweredReady(anItem({ state: STATE.READY, reply: folded({ status: "question", text: "Which?" }) })), false);
});

test("no other state is unanswered ready, and neither is a missing record", () => {
  for (const state of [STATE.DRAFT, STATE.HANDLED, STATE.NOT_HANDLED]) {
    assert.equal(isUnansweredReady(anItem({ state })), false, state);
    assert.equal(isUnansweredReady(anItem({ state, handled_not_on_page: true })), false, state + " with a stale flag");
  }
  assert.equal(isUnansweredReady(null), false);
  assert.equal(isUnansweredReady(undefined), false);
});

test("outstanding is ready and not_handled: still in front of the reviewer", () => {
  assert.equal(isOutstanding(inState(STATE.READY)), true);
  assert.equal(isOutstanding(inState(STATE.NOT_HANDLED)), true);
  assert.equal(isOutstanding(inState(STATE.DRAFT)), false);
  assert.equal(isOutstanding(inState(STATE.HANDLED)), false, "a handled item is kept and reopenable");
});

test("replayable is only a ready record whose current revision is not a tool round", () => {
  assert.equal(isReplayable(anItem({ state: STATE.READY })), true);
  for (const state of [STATE.NOT_HANDLED, STATE.HANDLED, STATE.DRAFT]) assert.equal(isReplayable(anItem({ state })), false, state);
  assert.equal(isReplayable(null), false);
  assert.equal(isReplayable(undefined), false);
  const round = anItem({ state: STATE.READY });
  stampPageCheckReopen(round, "T@1", "2026-01-01T00:00:00.000Z", TOOL_ROUND.PAGE_CHECK_STAMP);
  assert.equal(isReplayable(round), false, "a tool round is not replayed: the reviewer's card still reads handled");
});

test("a card is closed by the reviewer only when it is handled and carries the reviewer's mark", () => {
  assert.equal(isClosedByReviewer({ state: STATE.HANDLED, closed_by: "reviewer" }), true);
  assert.equal(isClosedByReviewer({ state: STATE.HANDLED }), false);
  assert.equal(isClosedByReviewer({ state: STATE.READY, closed_by: "reviewer" }), false, "a stale mark on a ready record");
  assert.equal(isClosedByReviewer({ state: STATE.NOT_HANDLED, closed_by: "reviewer" }), false);
  assert.equal(isClosedByReviewer(null), false);
  assert.equal(isClosedByReviewer(undefined), false);
});
