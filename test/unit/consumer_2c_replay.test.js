// THROWAWAY STUB CONSUMER: 2C (replay)
//
// Committed by 0A-kernel to prove its stubs are sufficient for 2C (replay), which is
// the single reason that task exists. It calls every kernel signature 2C (replay)
// will need and asserts the shape it gets back, so a missing or wrong-shaped
// stub fails HERE, in Phase 0, rather than in 2C (replay)'s worktree a phase later.
//
// ON THE PHASE 4B CLEANUP BATCH. Delete this file when 2C (replay) has landed.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const replay = require("../../src/layer/replay.js");
const anchor = require("../../src/layer/anchor.js");
const protect = require("../../src/layer/protect.js");
const fixtures = require("../../src/shared/record_fixtures.js").createFixtures({ seed: "2c" });

test("2C has all four compare branches, and the fixtures to drive each", () => {
  assert.deepEqual(replay.BRANCHES, ["already_applied", "reapply", "earlier_revision", "content_changed"]);

  const edit = fixtures.edit();
  assert.equal(replay.compare(edit, edit.after).branch, replay.BRANCH.ALREADY_APPLIED);
  assert.equal(replay.compare(edit, edit.before).branch, replay.BRANCH.REAPPLY);
  assert.equal(replay.compare(edit, "something else entirely").branch, replay.BRANCH.CONTENT_CHANGED);
});

test("branch three needs TWO rewordings, and the fixture generator provides one", () => {
  const item = fixtures.editRewordedTwice();
  const earlier = record.priorAfters(item)[0];
  assert.notEqual(earlier, item.after);
  assert.notEqual(earlier, item.before);
  const got = replay.compare(item, earlier);
  assert.equal(got.branch, replay.BRANCH.EARLIER_REVISION);
  assert.equal(got.earlierAfter, earlier);
  assert.equal(typeof replay.EARLIER_REVISION_MESSAGE, "string");
});

test("a format-only record compares on structure, so a text-equal change is still a change", () => {
  const fmt = fixtures.formatOnly();
  assert.equal(replay.compare(fmt, fmt.after_html).branch, replay.BRANCH.ALREADY_APPLIED);
  assert.equal(replay.compare(fmt, fmt.before_html).branch, replay.BRANCH.REAPPLY);
});

test("a delete is idempotent by absence", () => {
  const del = fixtures.deletion();
  assert.equal(replay.compare(del, null).branch, replay.BRANCH.ALREADY_APPLIED);
  assert.equal(replay.compare(del, del.before).branch, replay.BRANCH.REAPPLY);
});

test("2C's counters exist now, so a do-nothing engine cannot pass a replay test", () => {
  replay.resetCounters();
  for (const name of ["passes", "regionsWritten", "regionsSkippedProtected", "regionsSkippedEqual", "regionsEarlierRevision", "regionsConflicted", "regionsLost"]) {
    assert.equal(replay.counters[name], 0, name);
  }
  replay.runPass(replay.REASON.BOOT);
  assert.equal(replay.counters.passes, 1);
  assert.equal(replay.counters.regionsWritten, 0);
  assert.throws(() => replay.schedule("whenever"), /reason must be one of/);
  assert.deepEqual(replay.PASS_ORDER.map((s) => s.step), ["fold_replies", "merge_store", "retire_handled", "resolve_anchors", "apply_records", "update_rail"]);
});

test("2C skips a protected region and asks the anchor engine where a record goes", () => {
  assert.equal(typeof protect.isProtected, "function");
  assert.equal(typeof anchor.resolve, "function");
  const lost = fixtures.lostAnchor();
  assert.equal(lost.region.lost.code, "ANCHOR_NOT_FOUND", "a lost record is surfaced, never dropped");
});
