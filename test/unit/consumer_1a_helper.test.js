// THROWAWAY STUB CONSUMER: 1A (helper core)
//
// Committed by 0A-kernel to prove its stubs are sufficient for 1A (helper core), which is
// the single reason that task exists. It calls every kernel signature 1A (helper core)
// will need and asserts the shape it gets back, so a missing or wrong-shaped
// stub fails HERE, in Phase 0, rather than in 1A (helper core)'s worktree a phase later.
//
// ON THE PHASE 4B CLEANUP BATCH. Delete this file when 1A (helper core) has landed.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const lifecycle = require("../../src/shared/lifecycle.js");
const merge = require("../../src/shared/merge.js");
const manifest = require("../../src/shared/manifest.js");
const fixtures = require("../../src/shared/record_fixtures.js").createFixtures({ seed: "1a" });

test("1A can accept, validate, and store an item posted by a page", () => {
  const posted = fixtures.edit();
  record.validateItem(posted);
  assert.equal(typeof posted[record.FIELD.ID], "string");
  assert.equal(posted[record.FIELD.REV], 1);
  // The helper unifies origins: one review, two origins, one log.
  const other = fixtures.edit({ page_origin: "http://127.0.0.1:3000" });
  assert.notEqual(record.pageKey(posted), record.pageKey(other));
});

test("1A can project the log into what the library merges against", () => {
  const stored = fixtures.edit();
  const got = merge.mergeLists([], [stored]);
  assert.equal(got.items.length, 1);
  assert.equal(got.reasons[stored.id], merge.REASON.ONLY_STORE);
});

test("1A never invents a lifecycle move of its own", () => {
  for (const t of lifecycle.TRANSITIONS) assert.notEqual(t.actor, lifecycle.ACTOR.HELPER);
});

test("1A's files have one owner, including the ones it still has to create", () => {
  for (const path of ["src/service/index.js", "src/service/routes.js", "src/service/auth.js", "src/service/log.js", "src/service/state_dir.js", "src/service/reviews.js", "src/cli/index.js"]) {
    assert.equal(manifest.ownerOf(path), "1A", path);
  }
});
