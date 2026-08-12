// THROWAWAY STUB CONSUMER: 1B (library shell)
//
// Committed by 0A-kernel to prove its stubs are sufficient for 1B (library shell), which is
// the single reason that task exists. It calls every kernel signature 1B (library shell)
// will need and asserts the shape it gets back, so a missing or wrong-shaped
// stub fails HERE, in Phase 0, rather than in 1B (library shell)'s worktree a phase later.
//
// ON THE PHASE 4B CLEANUP BATCH. Delete this file when 1B (library shell) has landed.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const merge = require("../../src/shared/merge.js");
const overlay = require("../../src/layer/overlay.js");
const storeModule = require("../../src/layer/store.js");
const fixtures = require("../../src/shared/record_fixtures.js").createFixtures({ seed: "1b" });

test("1B can write, read, and delete through the real store, synchronously", () => {
  const store = storeModule.createStore();
  const item = fixtures.comment();
  store.write("rev_1", item);
  assert.equal(store.read("rev_1").length, 1);
  assert.equal(store.readItem("rev_1", item.id).id, item.id);
  assert.equal(store.remove("rev_1", item.id), true);
  assert.equal(store.read("rev_1").length, 0);
});

test("1B can keep a half-written draft, keyed by review id", () => {
  const store = storeModule.createStore();
  const draft = fixtures.draftComment();
  store.writeDraft("rev_1", draft);
  assert.equal(store.read("rev_1")[0].note, draft.note);
  assert.equal(store.read("rev_other").length, 0, "a review does not leak into another");
  assert.equal(store.keyFor("rev_1").startsWith(storeModule.KEY_PREFIX), true);
});

test("1B can merge the helper's state in on reconnect", () => {
  const store = storeModule.createStore();
  const local = fixtures.edit();
  store.write("rev_1", local);
  const fromHelper = Object.assign({}, local, { state: record.STATE.HANDLED });
  const got = store.mergeWithHelper("rev_1", [fromHelper]);
  assert.equal(got.items[0].state, record.STATE.HANDLED, "lifecycle is the store's");
  assert.equal(got.reasons[local.id], merge.REASON.SAME_REV_UNACKED);
});

test("1B can drive the rail: tabs, cards, chips, and the status line", () => {
  const rail = overlay.createRail();
  const item = fixtures.comment();
  rail.mount();
  assert.deepEqual(rail.TABS, ["active", "edits", "done"]);
  rail.selectTab(rail.TAB.EDITS);
  assert.equal(rail.currentTab(), "edits");

  const handle = rail.upsertCard(item);
  assert.equal(handle.id, item.id);
  assert.equal(rail.upsertCard(item).id, item.id, "a card is updated in place, never re-created");
  rail.setCardState(item.id, record.STATE.READY);
  rail.setCardNotice(item.id, "still a draft");

  rail.failures.add(overlay.failureFor("SYNC_SERVICE_DOWN", null));
  assert.equal(rail.failures.count(), 1);
  assert.equal(rail.failures.dismiss("SYNC_SERVICE_DOWN"), true);

  rail.setStatusLine(rail.STATUS.KEPT_LOCALLY);
  assert.equal(rail.getStatusLine(), "kept_locally");
  assert.equal(typeof rail.statusText(), "string");
  assert.throws(() => rail.setStatusLine("vibes"), /unknown status/);
});

test("1B's window lock has a signature to fill in", () => {
  const store = storeModule.createStore();
  const got = store.acquireWindowLock("rev_1");
  assert.equal(typeof got.acquired, "boolean");
  assert.equal(typeof store.refusalFailure().code, "string");
});
