// Fix round F3, service side (free writing, reviews_impl/FIX_ROUND.md): the
// projection re-checks run records it folds from the log, a proofread reply's
// fields survive the fold, and the reply line's suggestions are bounded.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const projection = require("../../src/service/projection.js");
const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const { createFixtures } = require("../../src/shared/record_fixtures.js");

const fx = () => createFixtures({ seed: "f3s" });

function created(item, seq) {
  return { event: protocol.EVENT.ITEM_CREATED, event_id: "e" + seq, seq: seq, item: item.id, rev: item.rev, record: item };
}

// --- SR 8: the fold checks what it folds -----------------------------------

test("a run record in the log that fails validateRun is dropped with a reason", () => {
  const f = fx();
  const good = f.runFixtures().find((x) => x.name === "worked example").item;
  const forged = f.runItem({ new_blocks: [{ tag: "script", html: "alert(1)" }] });
  const dropped = [];
  const state = projection.foldEvents(projection.createFold(), [created(good, 1), created(forged, 2)], {
    onDropped: (event, reason) => dropped.push({ id: event.item, reason: reason })
  });
  assert.ok(state.byId[good.id], "the valid run is folded");
  assert.equal(state.byId[forged.id], undefined, "the forged run is not");
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].id, forged.id);
  assert.ok(/RUN_BLOCK_REFUSED/.test(dropped[0].reason), dropped[0].reason);
});

test("an ordinary record is folded as before", () => {
  const edit = fx().edit();
  const state = projection.foldEvents(projection.createFold(), [created(edit, 1)]);
  assert.ok(state.byId[edit.id]);
});

// --- SR 4: suggestions are bounded on the wire ------------------------------

function line(suggestions) {
  return JSON.stringify({ item: "c_1", rev: 1, status: "question", agent: "a", text: "Fixes?", proofread: true, suggestions: suggestions });
}

test("a reply line with too many suggestions is refused", () => {
  const many = [];
  for (let i = 0; i <= protocol.SUGGESTIONS_MAX; i += 1) many.push({ block: 0, from: "a" + i, to: "b" });
  const got = protocol.parseReplyLine(line(many));
  assert.equal(got.ok, false);
  assert.ok(/suggestions/.test(got.reason), got.reason);
  assert.equal(protocol.parseReplyLine(line(many.slice(0, protocol.SUGGESTIONS_MAX))).ok, true);
});

test("a reply line whose from or to is over the run's byte ceiling is refused", () => {
  const big = "x".repeat(record.NEW_BLOCKS_MAX_BYTES + 1);
  assert.equal(protocol.parseReplyLine(line([{ block: 0, from: big, to: "y" }])).ok, false);
  assert.equal(protocol.parseReplyLine(line([{ block: 0, from: "y", to: big }])).ok, false);
});

test("the suggestion bounds restate the run ceilings", () => {
  assert.equal(protocol.SUGGESTIONS_MAX, record.NEW_BLOCKS_MAX);
  assert.equal(protocol.SUGGESTION_TEXT_MAX, record.NEW_BLOCKS_MAX_BYTES);
});
