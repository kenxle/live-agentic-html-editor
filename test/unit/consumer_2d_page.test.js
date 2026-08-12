// THROWAWAY STUB CONSUMER: 2D (living in the page)
//
// Committed by 0A-kernel to prove its stubs are sufficient for 2D (living in the page), which is
// the single reason that task exists. It calls every kernel signature 2D (living in the page)
// will need and asserts the shape it gets back, so a missing or wrong-shaped
// stub fails HERE, in Phase 0, rather than in 2D (living in the page)'s worktree a phase later.
//
// ON THE PHASE 4B CLEANUP BATCH. Delete this file when 2D (living in the page) has landed.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const gestures = require("../../src/shared/gestures.js");
const listeners = require("../../src/layer/listeners.js");
const replay = require("../../src/layer/replay.js");
const overlay = require("../../src/layer/overlay.js");
const markers = require("../../src/shared/markers.js");

test("2D can de-register every handler through the registry before a remount", () => {
  const registry = listeners.createRegistry();
  assert.equal(registry.count(), 0);
  assert.deepEqual(Object.keys(listeners.GROUP).length > 0, true);
  assert.equal(typeof registry.offGroup, "function");
  assert.equal(typeof registry.offAll, "function");
});

test("2D schedules replay after every remount path, including bfcache", () => {
  replay.resetCounters();
  assert.equal(replay.REASONS.includes(replay.REASON.REMOUNT), true);
  assert.equal(replay.REASONS.includes(replay.REASON.MUTATION), true);
  replay.schedule(replay.REASON.REMOUNT, { immediate: true });
  assert.equal(replay.counters.passes, 1);
});

test("2D can re-create the overlay root and knows its one id", () => {
  const rail = overlay.createRail();
  const mounted = rail.mount();
  assert.equal(mounted.rootId, markers.OVERLAY_ROOT_ID);
  assert.equal(rail.isMounted(), true);
  rail.unmount();
  assert.equal(rail.isMounted(), false);
});

test("2D tells a CSP refusal apart from a helper that is down", () => {
  const rail = overlay.createRail();
  rail.failures.add(overlay.failureFor("SYNC_POLICY_REFUSED", null));
  rail.failures.add(overlay.failureFor("SYNC_SERVICE_DOWN", null));
  assert.deepEqual(rail.failures.list().map((f) => f.code).sort(), ["SYNC_POLICY_REFUSED", "SYNC_SERVICE_DOWN"]);
  assert.notEqual(
    overlay.failureFor("SYNC_POLICY_REFUSED", null).message,
    overlay.failureFor("SYNC_SERVICE_DOWN", null).message
  );
});

test("browse is the page untouched: an ordinary click and key pass through", () => {
  assert.equal(gestures.gestureFor({ type: "click" }).passThrough, true);
  assert.equal(gestures.gestureFor({ type: "keydown", key: "a" }).passThrough, true);
});
