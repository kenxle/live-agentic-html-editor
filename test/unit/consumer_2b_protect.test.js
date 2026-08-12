// THROWAWAY STUB CONSUMER: 2B (protection)
//
// Committed by 0A-kernel to prove its stubs are sufficient for 2B (protection), which is
// the single reason that task exists. It calls every kernel signature 2B (protection)
// will need and asserts the shape it gets back, so a missing or wrong-shaped
// stub fails HERE, in Phase 0, rather than in 2B (protection)'s worktree a phase later.
//
// ON THE PHASE 4B CLEANUP BATCH. Delete this file when 2B (protection) has landed.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const protect = require("../../src/layer/protect.js");
const selection = require("../../src/layer/selection.js");
const replay = require("../../src/layer/replay.js");
const markers = require("../../src/shared/markers.js");

function anElement() {
  const children = [];
  const el = {
    tagName: "P",
    textContent: "the block being edited",
    attrs: {},
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
    },
    // 2B's landed protect.js reads and clears attributes as well as writing
    // them: layer one takes its skip attributes back off on release, and layer
    // three saves the block's editing surface so it can re-apply it after a
    // repaint rebuilt the element. A stand-in element needs the whole trio.
    hasAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attrs, k);
    },
    removeAttribute(k) {
      delete this.attrs[k];
    },
    contains(node) {
      return node === el || children.indexOf(node) !== -1;
    }
  };
  return el;
}

test("2B has all three layers as separate, callable signatures", () => {
  assert.deepEqual(protect.LAYERS, ["cooperative_skip", "veto", "snapshot_restore"]);
  assert.equal(typeof protect.mark, "function");
  assert.equal(typeof protect.veto, "function");
  assert.equal(typeof protect.snapshot, "function");
  assert.equal(typeof protect.restore, "function");
  assert.equal(typeof protect.release, "function");
});

test("2B can mark a region, veto a morph of it, and release it", () => {
  protect.resetCounters();
  const el = anElement();
  const active = protect.mark(el, { reason: "editing" });
  assert.equal(active.element, el);
  assert.equal(protect.isProtected(el), true);
  assert.equal(protect.counters.marked, 1);

  let prevented = false;
  const vetoed = protect.veto(el, { preventDefault: () => { prevented = true; } });
  assert.equal(vetoed, true);
  assert.equal(prevented, true, "layer two cancels the morph BEFORE it happens");
  assert.equal(protect.counters.vetoes, 1);

  assert.equal(protect.veto(anElement(), null), false, "an unprotected element is not vetoed");
  assert.equal(protect.release(el), true);
  assert.equal(protect.isProtected(el), false);
});

test("2B's layer three has its own counters, which its own assertion reads", () => {
  protect.resetCounters();
  const el = anElement();
  protect.mark(el, null);
  // Marking takes the first snapshot itself: a repaint that lands before the
  // reviewer's first keystroke would otherwise have nothing to restore to.
  assert.equal(protect.counters.snapshots, 1, "mark takes the opening snapshot");
  const snap = protect.snapshot(el);
  assert.equal(protect.counters.snapshots, 2);
  assert.equal(typeof snap.collapsed, "boolean");
  assert.equal(snap.text, "the block being edited");
  protect.restore(snap, el);
  assert.equal(protect.counters.restores + protect.counters.restoreFailures, 1);
  protect.release(el);
});

test("2B reads the caret through the frozen accessor and marks with the shared attribute", () => {
  assert.equal(typeof selection.containsCaret, "function");
  assert.equal(typeof selection.caretOffset, "function");
  assert.equal(typeof markers.PROTECTED_ATTR, "string");
  assert.equal(typeof markers.TURBO_PERMANENT_ATTR, "string");
});

test("2B can ask replay for the post-commit pass, which 2C owns", () => {
  assert.equal(replay.REASONS.includes(replay.REASON.COMMIT), true);
  assert.equal(typeof replay.schedule, "function");
});
