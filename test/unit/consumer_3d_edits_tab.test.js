// THROWAWAY STUB CONSUMER: 3D (the Edits tab)
//
// Committed by 0A-kernel to prove its stubs are sufficient for 3D (the Edits tab), which is
// the single reason that task exists. It calls every kernel signature 3D (the Edits tab)
// will need and asserts the shape it gets back, so a missing or wrong-shaped
// stub fails HERE, in Phase 0, rather than in 3D (the Edits tab)'s worktree a phase later.
//
// ON THE PHASE 4B CLEANUP BATCH. Delete this file when 3D (the Edits tab) has landed.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const overlay = require("../../src/layer/overlay.js");
const storeModule = require("../../src/layer/store.js");
const fixtures = require("../../src/shared/record_fixtures.js").createFixtures({ seed: "3d" });

test("3D can list every hand edit as a before-and-after row, including a formatting-only one", () => {
  const store = storeModule.createStore();
  const edits = fixtures.manyEdits(5).concat([fixtures.formatOnly()]);
  for (const item of edits) store.write("rev_1", item);
  store.write("rev_1", fixtures.comment());

  const rows = store.read("rev_1").filter((i) => i.kind === record.KIND.EDIT || i.kind === record.KIND.FORMAT_ONLY || i.kind === record.KIND.DELETE);
  assert.equal(rows.length, 6);
  for (const row of rows) {
    assert.equal(Object.prototype.hasOwnProperty.call(row, record.FIELD.BEFORE), true);
    assert.equal(Object.prototype.hasOwnProperty.call(row, record.FIELD.AFTER), true);
  }
  assert.equal(rows.some((r) => r.kind === record.KIND.FORMAT_ONLY), true);
});

test("hand edits are kept apart from the comment thread (R32)", () => {
  const rail = overlay.createRail();
  assert.equal(rail.TABS.includes(rail.TAB.EDITS), true);
  rail.selectTab(rail.TAB.EDITS);
  assert.equal(rail.currentTab(), "edits");
  const comment = fixtures.comment();
  assert.notEqual(comment.kind, record.KIND.EDIT);
});
