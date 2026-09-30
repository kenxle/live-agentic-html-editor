// Free writing, editing workstream (plan Tasks 2.1 to 2.4): the words and
// numbers the plan pins, spelled once in src/layer/editing.js, and the one
// page-level rule highlight.js adds for the editing host.
//
// The behaviour itself is proven in real browsers (test/browser/free_writing_*).
// These hold the spellings, so a copy edit in one place cannot drift from the
// plan's "Words this plan pins" table without a test saying so.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const editing = require("../../src/layer/editing.js");
const highlight = require("../../src/layer/highlight.js");
const protect = require("../../src/layer/protect.js");
const markers = require("../../src/shared/markers.js");
const gestures = require("../../src/shared/gestures.js");

test("the bar says Editing for every edit (PQ2)", () => {
  assert.equal(editing.LABEL_EDITING, "Editing");
});

test("the pinned words, exactly as the plan spells them", () => {
  assert.equal(editing.HINT_EDIT_STATE, "Click + Write here to add text. Esc to finish.");
  assert.equal(editing.INSERT_LINE_LABEL, "+ Write here");
  assert.equal(editing.PLACEHOLDER, "Start writing");
  assert.equal(
    editing.CEILING_WARN,
    "This edit is getting long. Press Esc to send it. Once the agent places it, you can keep writing."
  );
  assert.equal(
    editing.CEILING_FULL,
    "This edit is full. Press Esc to send it. Once the agent places it, you can keep writing."
  );
  assert.equal(editing.ANNOUNCE.AFTER, "Writing after: {words}");
  assert.equal(editing.ANNOUNCE.START_OF_PAGE, "Writing at the start of the page");
  assert.equal(editing.ANNOUNCE.COMMIT, "Sent to the agent");
});

test("the edit-state hint is the gesture table's own line, not a second spelling", () => {
  const row = gestures.TABLE.find((r) => r.gesture === gestures.GESTURE.ENTER_EDIT_STATE);
  assert.equal(row.hint, editing.HINT_EDIT_STATE);
});

test("the numbers the plan sets for this file", () => {
  assert.equal(editing.SESSION_HISTORY_MAX, 100);
  assert.equal(editing.TYPING_BURST_IDLE_MS, 1000);
  assert.equal(editing.CEILING_WARN_RATIO, 0.9);
});

test("the focus-ring rule matches only the attribute the layer sets on the host", () => {
  const rule = highlight.EDIT_HOST_RULE;
  assert.ok(rule.indexOf("[" + markers.EDIT_HOST_ATTR + "]:focus") === 0, rule);
  assert.match(rule, /\{ outline: none; \}$/);
  // Every selector in it is scoped to the host attribute.
  rule
    .slice(0, rule.indexOf("{"))
    .split(",")
    .forEach((sel) => assert.ok(sel.trim().indexOf("[" + markers.EDIT_HOST_ATTR + "]") === 0, sel));
  // And the host attribute is a data-lahe name, so cleanMarkup strips it.
  assert.equal(markers.EDIT_HOST_ATTR.indexOf("data-lahe"), 0);
});

test("protection offers the two seams a run session needs", () => {
  assert.equal(typeof protect.rebindTo, "function");
  assert.equal(typeof protect.protectedBlocks, "function");
  assert.equal(protect.protectedBlocks(), null, "outside a restore there is nothing to hand back");
});
