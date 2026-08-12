// THROWAWAY STUB CONSUMER: 2A (editing)
//
// Committed by 0A-kernel to prove its stubs are sufficient for 2A (editing), which is
// the single reason that task exists. It calls every kernel signature 2A (editing)
// will need and asserts the shape it gets back, so a missing or wrong-shaped
// stub fails HERE, in Phase 0, rather than in 2A (editing)'s worktree a phase later.
//
// ON THE PHASE 4B CLEANUP BATCH. Delete this file when 2A (editing) has landed.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const normalize = require("../../src/shared/normalize.js");
const gestures = require("../../src/shared/gestures.js");
const selection = require("../../src/layer/selection.js");
const storeModule = require("../../src/layer/store.js");
const fixtures = require("../../src/shared/record_fixtures.js").createFixtures({ seed: "2a" });

test("2A can read the caret through the one accessor", () => {
  // No document here, so every accessor answers honestly rather than faking.
  assert.equal(selection.caretNode(), null);
  assert.equal(selection.caretContainer(), null);
  assert.equal(selection.caretOffset(), null);
  assert.equal(selection.containsCaret(null), false);
  assert.equal(selection.hasSelection(), false);
  assert.equal(selection.selectedText(), "");
  assert.equal(selection.selectedRange(), null);
  assert.equal(typeof selection.blockFor, "function");
  assert.equal(selection.BLOCK_TAGS.includes("P"), true);
});

test("2A's before is pinned at first touch across a re-entry (R29)", () => {
  const store = storeModule.createStore();
  const first = fixtures.edit({ before: "the page's own wording", after: "the reviewer's first go" });
  store.write("rev_1", first);
  const second = record.bumpRev(first, { after: "the reviewer's second go" });
  store.write("rev_1", second);
  const stored = store.readItem("rev_1", first.id);
  assert.equal(stored.before, "the page's own wording", "before never drifts to the last commit");
  assert.equal(stored.rev, 2);
  assert.equal(stored.id, first.id, "one id, one record");
  assert.equal(record.priorAfters(stored).includes("the reviewer's first go"), true);
});

test("2A can record a delete and a formatting-only change as their own kinds", () => {
  assert.equal(fixtures.deletion().kind, record.KIND.DELETE);
  const fmt = fixtures.formatOnly();
  assert.equal(fmt.kind, record.KIND.FORMAT_ONLY);
  assert.equal(record.comparisonMode(fmt), normalize.MODE.STRUCTURE);
});

test("2A never lets library markup into a record (R23)", () => {
  const dirty = '<p>Hi <span data-lahe="chrome">chip</span>there</p>';
  assert.equal(normalize.cleanMarkup(dirty).includes("data-lahe"), false);
  assert.equal(normalize.cleanMarkup(dirty).includes("chip"), false);
});

test("2A's entry and exit gestures are Cmd-Shift-E and Esc", () => {
  assert.equal(gestures.gestureFor({ type: "keydown", key: "e", metaKey: true, shiftKey: true }).gesture, gestures.GESTURE.EDIT_BLOCK);
  assert.equal(gestures.gestureFor({ type: "keydown", key: "Escape", editing: true }).gesture, gestures.GESTURE.COMMIT_EDIT);
  const outside = gestures.gestureFor({ type: "click", editing: true, inEditedBlock: false });
  assert.equal(outside.gesture, gestures.GESTURE.COMMIT_EDIT);
  assert.equal(outside.passThrough, true, "the page still gets the click, so navigation is not a losing move");
});
