// THROWAWAY STUB CONSUMER: 3C (copy and export)
//
// Committed by 0A-kernel to prove its stubs are sufficient for 3C (copy and export), which is
// the single reason that task exists. It calls every kernel signature 3C (copy and export)
// will need and asserts the shape it gets back, so a missing or wrong-shaped
// stub fails HERE, in Phase 0, rather than in 3C (copy and export)'s worktree a phase later.
//
// ON THE PHASE 4B CLEANUP BATCH. Delete this file when 3C (copy and export) has landed.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const manifest = require("../../src/shared/manifest.js");
const storeModule = require("../../src/layer/store.js");
const fixtures = require("../../src/shared/record_fixtures.js").createFixtures({ seed: "3c" });

test("3C can read this browser's whole slice with nothing running", () => {
  const store = storeModule.createStore();
  const items = fixtures.manyEdits(3);
  for (const item of items) store.write("rev_1", item);
  assert.equal(store.read("rev_1").length, 3);
  assert.deepEqual(store.reviews(), ["rev_1"], "the slice label is scoped to what this origin holds");
});

test("3C exports the reviewer's words verbatim and the page's words as data", () => {
  const item = fixtures.comment();
  assert.equal(record.fieldClass(record.FIELD.NOTE), record.CLASS_INSTRUCTION);
  assert.equal(record.fieldClass(record.FIELD.AFTER), record.CLASS_DATA);
  assert.equal(typeof item.note, "string");
});

test("3C consumes the shared formatter and never edits it", () => {
  assert.match(manifest.ownerOf("src/shared/review_format.js"), /FROZEN at CP0/);
  assert.equal(manifest.ownerOf("src/layer/export.js"), "3C");
});
