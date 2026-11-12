/*
 * read-when: Changing src/domain/tool-round.ts, or the rail shows, or hides, a page-check exchange, or a card sits in the wrong tab, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { STATE, TOOL_ROUND, emptyRegion } from "../../../src/contract/record.ts";
import type { CheckReopen, Item, ThreadRound } from "../../../src/contract/record.ts";
import { bumpRev } from "../../../src/domain/item-revisions.ts";
import { pageCheckReopenOf, stampPageCheckReopen } from "../../../src/domain/page-check.ts";
import { answeredPageCheckReopen, displayState, isToolRound, pageCheckReopen, toolRoundOf } from "../../../src/domain/tool-round.ts";
import { callUntyped } from "../contract/support/untyped.ts";
import { anItem, archived, folded } from "./support/items.ts";

const AT = "2026-08-18T12:00:00.000Z";

function withCheck(item: Item, checkReopen: CheckReopen | null): Item {
  return { ...item, region: { ...emptyRegion(), check_reopen: checkReopen } };
}

function stamped(tool: "page_check_stamp" | null): Item {
  const item = anItem({ state: STATE.READY, rev: 3 });
  stampPageCheckReopen(item, "T@2", AT, tool);
  return item;
}

test("a record with no stamp has no page-check reopen, and nor has a missing record", () => {
  assert.equal(pageCheckReopen(anItem()), null);
  assert.equal(pageCheckReopen(null), null);
  assert.equal(pageCheckReopen(undefined), null);
  assert.deepEqual(pageCheckReopen(stamped("page_check_stamp")), { rev: 3, at: AT, stamp: "T@2", tool: "page_check_stamp" });
});

test("only an object in region.check_reopen counts as a stamp", () => {
  assert.equal(pageCheckReopen(withCheck(anItem(), null)), null);
  const junk = { ...anItem(), region: { ...emptyRegion(), check_reopen: "yes" } };
  assert.equal(callUntyped(pageCheckReopen, junk), null);
  assert.equal(callUntyped(pageCheckReopen, {}), null, "a record with no region");
  assert.equal(callUntyped(pageCheckReopen, { region: null }), null);
});

test("the stamp's tool is the record's tool round while the stamp's revision is the record's", () => {
  assert.equal(toolRoundOf(stamped("page_check_stamp")), "page_check_stamp");
  assert.equal(toolRoundOf(anItem()), null);
  assert.equal(toolRoundOf(null), null);
  assert.equal(toolRoundOf(undefined), null);
});

test("a reopen that names no tool is the reviewer's business, so it is not a tool round", () => {
  assert.equal(toolRoundOf(stamped(null)), null);
  assert.equal(answeredPageCheckReopen(stamped(null)), true, "but it is still a reopen the check made");
});

test("any later revision ends the round", () => {
  const round = stamped("page_check_stamp");
  assert.equal(toolRoundOf(round), "page_check_stamp");
  assert.equal(toolRoundOf(bumpRev(round, { note: "reworded" })), null);
  assert.equal(toolRoundOf({ ...round, rev: 2 }), null, "a stamp for a later revision than the record's is not its round either");
});

test("a round is a tool round when its tool is a tool round name", () => {
  assert.equal(isToolRound({ tool: TOOL_ROUND.PAGE_CHECK_STAMP }), true);
  assert.equal(isToolRound({}), false);
  assert.equal(isToolRound(null), false);
  assert.equal(isToolRound(undefined), false);
});

test("the page check's reopen was answered when the stamp's revision is the record's, whatever its tool", () => {
  assert.equal(answeredPageCheckReopen(stamped("page_check_stamp")), true);
  assert.equal(answeredPageCheckReopen(anItem()), false, "with no stamp");
  assert.equal(answeredPageCheckReopen(null), false);
  assert.equal(answeredPageCheckReopen(bumpRev(stamped("page_check_stamp"), {})), false, "a later revision is a new matter");
  assert.equal(answeredPageCheckReopen(withCheck(anItem({ rev: 5 }), { rev: 5, at: AT, stamp: null, tool: null })), true);
});

test("a tool round reads as handled to the reviewer and as ready to everyone else", () => {
  const item = anItem({ state: STATE.READY, rev: 2, reply: folded() });
  const reopened = pageCheckReopenOf({ ...item, state: STATE.HANDLED, reply: folded({ at: AT }) }, "Reopened by the page check.", AT, TOOL_ROUND.PAGE_CHECK_STAMP);
  assert.equal(reopened.state, STATE.READY, "everyone else reads ready");
  assert.equal(displayState(reopened), STATE.HANDLED, "the reviewer's decision has not changed");
  assert.equal(displayState(bumpRev(reopened, {})), STATE.READY, "a later revision ends it");
});

test("a record's display state is its own state with no tool round open, and null for no record", () => {
  for (const state of [STATE.DRAFT, STATE.READY, STATE.HANDLED, STATE.NOT_HANDLED]) {
    assert.equal(displayState(anItem({ state })), state, state);
  }
  assert.equal(displayState(null), null);
  assert.equal(displayState(undefined), null);
});

test("the archived tool round travels marked", () => {
  const round = { rev: 1, reviewer: { note: null, change: null, at: AT }, agent: archived(), tool: TOOL_ROUND.PAGE_CHECK_STAMP };
  assert.equal(isToolRound(round), true);
  const plain: ThreadRound = { rev: 1, reviewer: { note: null, change: null, at: AT }, agent: archived() };
  assert.equal(isToolRound(plain), false);
});
