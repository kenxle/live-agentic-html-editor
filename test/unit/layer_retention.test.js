// What the layer lets go of while the page stays open.
//
// The 2026-09-16 memory audit (docs/ongoing/MEMORY_AUDIT_20260916.md) found a
// handful of module-level collections that only ever grew. Most of them are
// asserted where their own module is already tested: the element memory in
// replay_pass.test.js, the page's announcement memory in reply_toast.test.js,
// the creation nodes in comments_surface.test.js, and the conflict card's node
// in the browser, because it is a node.
//
// This file is for the ones with no other unit home.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const layer = require("../../src/layer/index.js");

// The status line's history. It grows one entry per TRANSITION, so an ordinary
// session adds a handful; a helper that flaps (down, up, down, up, all
// afternoon) adds one per flap, forever, and nothing reads more than the tail.
test("the status history keeps the newest entries and nothing older", () => {
  assert.equal(layer.STATUS_LOG_MAX, 200);

  const log = [];
  for (let i = 0; i < layer.STATUS_LOG_MAX + 50; i += 1) layer.pushCapped(log, "state-" + i, layer.STATUS_LOG_MAX);

  assert.equal(log.length, layer.STATUS_LOG_MAX, "capped, however long the helper flaps");
  assert.equal(log[log.length - 1], "state-249", "the newest transition is the last one");
  assert.equal(log[0], "state-50", "and the oldest that still fits is the first");
});

test("a history under the cap is untouched", () => {
  const log = [];
  layer.pushCapped(log, "kept_locally", 200);
  layer.pushCapped(log, "stored", 200);
  assert.deepEqual(log, ["kept_locally", "stored"]);
});
